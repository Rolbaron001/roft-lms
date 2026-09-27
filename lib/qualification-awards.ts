import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { enrolments, qualificationAwards, qualifications } from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Recording the qualification certificate a learner has received.
 *
 * Job sheet D2, 27 September 2026. The provider issues statements of results
 * and badges; the qualification certificate comes from the body that awards
 * it, for an occupational qualification the QCTO after the EISA. The platform
 * records that it arrived, with its number and date, so a learner's record
 * can say they are qualified, and the cohort archive can tell a cohort that
 * has its certificates from one still waiting.
 */

export class AwardError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "not_enrolled" | "already_recorded",
  ) {
    super(message);
    this.name = "AwardError";
  }
}

const awardInput = z.object({
  userId: z.string().uuid(),
  qualificationId: z.string().uuid(),
  certificateNumber: z.string().trim().min(1, "The certificate number is needed.").max(100),
  awardedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "The date on the certificate is needed."),
  awardedBy: z.string().trim().min(1).max(200).default("QCTO"),
  note: z.string().trim().max(1000).optional(),
});

export async function recordQualificationAward(
  session: AuthenticatedSession,
  input: z.input<typeof awardInput>,
) {
  assertSessionCan(session, "enrolment:manage");
  const parsed = awardInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    // Only against a qualification the learner is enrolled on here: a
    // certificate for something they never studied with this provider is not
    // this provider's record to keep.
    const [enrolled] = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.userId, parsed.userId),
          eq(enrolments.qualificationId, parsed.qualificationId),
        ),
      )
      .limit(1);
    if (!enrolled) {
      throw new AwardError(
        "This learner is not enrolled on that qualification here, so its certificate cannot be recorded against them.",
        "not_enrolled",
      );
    }

    const [existing] = await tx
      .select({ number: qualificationAwards.certificateNumber })
      .from(qualificationAwards)
      .where(
        and(
          eq(qualificationAwards.userId, parsed.userId),
          eq(qualificationAwards.qualificationId, parsed.qualificationId),
        ),
      );
    if (existing) {
      throw new AwardError(
        `Certificate ${existing.number} is already recorded for this qualification. Remove it first if it was entered wrongly.`,
        "already_recorded",
      );
    }

    const [created] = await tx
      .insert(qualificationAwards)
      .values({
        organisationId: session.organisationId,
        userId: parsed.userId,
        qualificationId: parsed.qualificationId,
        certificateNumber: parsed.certificateNumber,
        awardedOn: parsed.awardedOn,
        awardedBy: parsed.awardedBy,
        note: parsed.note || null,
        recordedById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "qualification_award.recorded",
      entityType: "qualification_award",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

/**
 * Removes a certificate entered wrongly. The audit log keeps what it said.
 *
 * Removal rather than editing, so that a corrected number is a new entry by a
 * named person, not a quiet change to an old one.
 */
export async function removeQualificationAward(
  session: AuthenticatedSession,
  awardId: string,
  reason: string,
) {
  assertSessionCan(session, "enrolment:manage");
  const why = z.string().trim().min(3, "Say why it is being removed.").max(1000).parse(reason);

  return withTenant(session.organisationId, async (tx) => {
    const [removed] = await tx
      .delete(qualificationAwards)
      .where(eq(qualificationAwards.id, awardId))
      .returning();
    if (!removed) throw new AwardError("No such certificate is recorded.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "qualification_award.removed",
      entityType: "qualification_award",
      entityId: awardId,
      before: removed,
      after: { reason: why },
    });
  });
}

/**
 * The certificates a learner holds. Their own, or anybody's for staff who can
 * read every enrolment.
 */
export async function awardsFor(session: AuthenticatedSession, userId: string) {
  if (userId !== session.userId) assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: qualificationAwards.id,
        qualificationId: qualificationAwards.qualificationId,
        qualificationTitle: qualifications.title,
        certificateNumber: qualificationAwards.certificateNumber,
        awardedOn: qualificationAwards.awardedOn,
        awardedBy: qualificationAwards.awardedBy,
        note: qualificationAwards.note,
      })
      .from(qualificationAwards)
      .innerJoin(qualifications, eq(qualifications.id, qualificationAwards.qualificationId))
      .where(eq(qualificationAwards.userId, userId))
      .orderBy(desc(qualificationAwards.awardedOn)),
  );
}
