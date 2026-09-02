import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessments,
  missedAssessments,
  supportNeeds,
  supportReviews,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Learner support and special needs.
 *
 * Two things live here that look unrelated and are not. Both come from the same
 * procedure, and both exist because a learner's circumstances change what the
 * provider owes them.
 *
 * The first is the support need itself, which is the most sensitive record the
 * platform holds. Health, disability and financial hardship are special
 * personal information, and the justification for holding them is narrow: the
 * provider cannot make a reasonable accommodation without knowing what to
 * accommodate. Nothing beyond that is justified, so the record is split. The
 * need - the diagnosis, the symptoms, the circumstances - is restricted. The
 * accommodation - allow breaks, seat near the door, provide printed materials -
 * goes to whoever has to do it, without the reason attached.
 *
 * That split is not decoration. The procedure says the coordinator "must inform
 * the Facilitator / Assessor of learner requirements", and a platform that
 * satisfies that by showing a facilitator somebody's diagnosis has done more
 * than it was asked and more than it should.
 *
 * The second is the missed summative. The procedure allows one additional date
 * and one only, and if that is missed on medical grounds the learner goes to an
 * oral assessment with an employer observer. The number is the whole point:
 * without a record of the first miss, a third and fourth date get arranged one
 * conversation at a time, and the provider finds out when somebody counts
 * sittings.
 */

export class SupportError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "invalid"
      | "no_consent"
      | "already_granted"
      | "not_eligible"
      | "closed",
  ) {
    super(message);
    this.name = "SupportError";
  }
}

// ---------------------------------------------------------------------------
// The need
// ---------------------------------------------------------------------------

const needInput = z.object({
  learnerId: z.string().uuid(),
  category: z.enum([
    "mobility",
    "psychological",
    "economic",
    "sensory",
    "other",
  ]),
  /** The sensitive half. Optional on purpose - see below. */
  need: z.string().trim().max(4000).optional(),
  accommodation: z
    .string()
    .trim()
    .min(
      5,
      "Say what will actually be done. A need with no accommodation against it changes nothing for the learner.",
    )
    .max(4000),
  learnerConsented: z.boolean(),
  employerInformed: z.boolean().optional(),
  employerRepresentative: z.string().trim().max(200).optional(),
  reviewDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type SupportNeedInput = z.input<typeof needInput>;

/**
 * Records a support need.
 *
 * Refuses without the learner's consent. Special personal information needs it,
 * and consent to enrol is not consent to this. A coordinator acting in good
 * faith for somebody who has not agreed is still processing health data without
 * a basis, and the refusal is the only thing that makes anyone ask.
 *
 * The sensitive detail is optional. That is deliberate and it is the
 * recommendation: a record saying "allow breaks every 40 minutes" with nothing
 * else attached serves the learner exactly as well and puts far less at risk.
 */
export async function recordSupportNeed(
  session: AuthenticatedSession,
  input: SupportNeedInput,
) {
  assertSessionCan(session, "support:manage");
  const parsed = needInput.parse(input);

  if (!parsed.learnerConsented) {
    throw new SupportError(
      "The learner has to agree to this being recorded before it can be. Health, disability and financial circumstances are special personal information, and agreeing to enrol was not agreeing to this.",
      "no_consent",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(supportNeeds)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        category: parsed.category,
        need: parsed.need || null,
        accommodation: parsed.accommodation,
        learnerConsented: true,
        consentRecordedAt: new Date(),
        employerInformed: parsed.employerInformed ?? false,
        employerRepresentative: parsed.employerRepresentative || null,
        reviewDue: parsed.reviewDue ?? null,
        raisedById: session.userId,
      })
      .returning();

    // The category and the fact of a record, never the detail. An audit log is
    // read by more people than the record it describes, and copying a
    // diagnosis into it would undo the whole split.
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "support.need_recorded",
      entityType: "support_need",
      entityId: created.id,
      after: {
        learnerId: created.learnerId,
        category: created.category,
        detailHeld: created.need !== null,
      },
    });

    return created;
  });
}

const reviewInput = z.object({
  supportNeedId: z.string().uuid(),
  reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  working: z.boolean(),
  note: z
    .string()
    .trim()
    .min(5, "Say what you found. A review with no finding is a date in a file."),
  adjustment: z.string().trim().max(2000).optional(),
  nextReviewDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Records a check-in on a support plan.
 *
 * Refuses to record a review that found the accommodation not working without
 * saying what changed as a result. "We reviewed it and it was not working" with
 * nothing after it is the shape of a plan nobody adjusted, and writing it down
 * makes the failure look like diligence.
 */
export async function recordSupportReview(
  session: AuthenticatedSession,
  input: z.input<typeof reviewInput>,
) {
  assertSessionCan(session, "support:manage");
  const parsed = reviewInput.parse(input);

  if (!parsed.working && !parsed.adjustment) {
    throw new SupportError(
      "If the accommodation is not working, say what is changing. A review that records a failure and adjusts nothing reads as diligence and is the opposite.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [need] = await tx
      .select()
      .from(supportNeeds)
      .where(eq(supportNeeds.id, parsed.supportNeedId));

    if (!need) throw new SupportError("Support need not found.", "not_found");
    if (need.status === "closed") {
      throw new SupportError("That support need is closed.", "closed");
    }

    const [created] = await tx
      .insert(supportReviews)
      .values({
        organisationId: session.organisationId,
        supportNeedId: parsed.supportNeedId,
        reviewedOn: parsed.reviewedOn,
        reviewedById: session.userId,
        working: parsed.working,
        note: parsed.note,
        adjustment: parsed.adjustment || null,
      })
      .returning();

    await tx
      .update(supportNeeds)
      .set({
        reviewDue: parsed.nextReviewDue ?? null,
        updatedAt: new Date(),
      })
      .where(eq(supportNeeds.id, parsed.supportNeedId));

    return created;
  });
}

export async function closeSupportNeed(
  session: AuthenticatedSession,
  input: { supportNeedId: string; reason: string },
) {
  assertSessionCan(session, "support:manage");

  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new SupportError(
      "Say why the support is ending. A learner whose accommodation stops without a reason has no way to ask for it back.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(supportNeeds)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedReason: reason,
        reviewDue: null,
        updatedAt: new Date(),
      })
      .where(eq(supportNeeds.id, input.supportNeedId))
      .returning();

    if (!updated) throw new SupportError("Support need not found.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "support.need_closed",
      entityType: "support_need",
      entityId: input.supportNeedId,
      after: { reason },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Reading, at two levels
// ---------------------------------------------------------------------------

export type SupportRecord = {
  id: string;
  learnerId: string;
  category: string;
  /** Null when the reader is not entitled to it, and null when none was kept. */
  need: string | null;
  /** Whether detail exists that this reader is not being shown. */
  detailWithheld: boolean;
  accommodation: string;
  learnerConsented: boolean;
  employerInformed: boolean;
  employerRepresentative: string | null;
  status: string;
  reviewDue: string | null;
  raisedByName: string;
  createdAt: Date;
};

/**
 * A learner's support records, redacted to what this reader may see.
 *
 * Two permissions, and the difference between them is the point of this
 * module. `support:act` gets the accommodation, which is what somebody
 * standing in front of the learner needs. `support:read` additionally gets the
 * need behind it, and belongs to the handful of people whose job requires it.
 *
 * Where detail exists and is being withheld, the reader is told that it exists.
 * Hiding the existence too would leave a facilitator unable to tell "there is
 * nothing more to know" from "there is more and it is not mine to see", and
 * the second is a thing they should know they can go and ask about.
 */
export async function learnerSupport(
  session: AuthenticatedSession,
  learnerId: string,
): Promise<SupportRecord[]> {
  assertSessionCan(session, "support:act");
  const mayReadDetail = session.permissions.includes("support:read");

  return withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .select({
        id: supportNeeds.id,
        learnerId: supportNeeds.learnerId,
        category: supportNeeds.category,
        need: supportNeeds.need,
        accommodation: supportNeeds.accommodation,
        learnerConsented: supportNeeds.learnerConsented,
        employerInformed: supportNeeds.employerInformed,
        employerRepresentative: supportNeeds.employerRepresentative,
        status: supportNeeds.status,
        reviewDue: supportNeeds.reviewDue,
        createdAt: supportNeeds.createdAt,
        raisedFirstName: users.firstName,
        raisedLastName: users.lastName,
      })
      .from(supportNeeds)
      .innerJoin(users, eq(users.id, supportNeeds.raisedById))
      .where(eq(supportNeeds.learnerId, learnerId))
      .orderBy(desc(supportNeeds.createdAt));

    return found.map(({ raisedFirstName, raisedLastName, ...row }) => ({
      ...row,
      need: mayReadDetail ? row.need : null,
      detailWithheld: !mayReadDetail && row.need !== null,
      raisedByName: `${raisedFirstName} ${raisedLastName}`,
    }));
  });
}

export async function supportReviewHistory(
  session: AuthenticatedSession,
  supportNeedId: string,
) {
  assertSessionCan(session, "support:act");

  return withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .select({
        id: supportReviews.id,
        reviewedOn: supportReviews.reviewedOn,
        working: supportReviews.working,
        note: supportReviews.note,
        adjustment: supportReviews.adjustment,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(supportReviews)
      .innerJoin(users, eq(users.id, supportReviews.reviewedById))
      .where(eq(supportReviews.supportNeedId, supportNeedId))
      .orderBy(desc(supportReviews.reviewedOn));

    return found.map(({ firstName, lastName, ...row }) => ({
      ...row,
      reviewedByName: `${firstName} ${lastName}`,
    }));
  });
}

/** Support plans whose review date has passed. The procedure asks for these. */
export async function supportReviewsDue(
  session: AuthenticatedSession,
  asAt: string,
) {
  assertSessionCan(session, "support:read");

  return withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .select({
        id: supportNeeds.id,
        learnerId: supportNeeds.learnerId,
        category: supportNeeds.category,
        accommodation: supportNeeds.accommodation,
        reviewDue: supportNeeds.reviewDue,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(supportNeeds)
      .innerJoin(users, eq(users.id, supportNeeds.learnerId))
      .where(eq(supportNeeds.status, "active"))
      .orderBy(asc(supportNeeds.reviewDue));

    return found
      .filter((row) => row.reviewDue !== null && row.reviewDue <= asAt)
      .map(({ firstName, lastName, ...row }) => ({
        ...row,
        learnerName: `${firstName} ${lastName}`,
      }));
  });
}

// ---------------------------------------------------------------------------
// The missed summative, and the one additional date
// ---------------------------------------------------------------------------

const missInput = z.object({
  learnerId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  missedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  missedReason: z.string().trim().max(2000).optional(),
  additionalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Records a missed summative and sets the one additional date.
 *
 * Refuses a second. The procedure allows one, and the reason to enforce it here
 * rather than trust it is that nobody ever grants a fourth date deliberately -
 * they grant a second one twice, months apart, because the first was arranged
 * by someone else in a conversation nobody wrote down.
 *
 * The refusal names the date already granted, so the person hitting it can see
 * whether they are duplicating somebody's work or looking at a learner who has
 * genuinely run out of chances.
 */
export async function recordMissedAssessment(
  session: AuthenticatedSession,
  input: z.input<typeof missInput>,
) {
  assertSessionCan(session, "support:manage");
  const parsed = missInput.parse(input);

  if (parsed.additionalDate <= parsed.missedOn) {
    throw new SupportError(
      "The additional date has to be after the one that was missed.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(missedAssessments)
      .where(
        and(
          eq(missedAssessments.learnerId, parsed.learnerId),
          eq(missedAssessments.assessmentId, parsed.assessmentId),
        ),
      );

    if (existing) {
      throw new SupportError(
        `An additional date was already set for this assessment: ${existing.additionalDate ?? "none recorded"}, after a miss on ${existing.missedOn}. The procedure allows one. If that date was also missed, record what happened to it rather than setting another.`,
        "already_granted",
      );
    }

    const [created] = await tx
      .insert(missedAssessments)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        assessmentId: parsed.assessmentId,
        missedOn: parsed.missedOn,
        missedReason: parsed.missedReason || null,
        additionalDate: parsed.additionalDate,
        additionalDateSetById: session.userId,
        outcome: "additional_date_set",
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "support.additional_date_set",
      entityType: "missed_assessment",
      entityId: created.id,
      after: {
        learnerId: created.learnerId,
        assessmentId: created.assessmentId,
        missedOn: created.missedOn,
        additionalDate: created.additionalDate,
      },
    });

    return created;
  });
}

const secondMissInput = z.object({
  missedAssessmentId: z.string().uuid(),
  outcome: z.enum(["sat", "oral_authorised", "forfeited"]),
  medical: z.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Records what became of the additional date.
 *
 * The oral route opens only on a medical ground, because that is what the
 * procedure says and because "missed it again" is otherwise an unlimited
 * supply of further chances wearing a different name. Refusing here is the
 * only place the distinction is ever forced.
 */
export async function recordAdditionalDateOutcome(
  session: AuthenticatedSession,
  input: z.input<typeof secondMissInput>,
) {
  assertSessionCan(session, "support:manage");
  const parsed = secondMissInput.parse(input);

  if (parsed.outcome === "oral_authorised" && !parsed.medical) {
    throw new SupportError(
      "An oral assessment follows a second miss only on medical grounds. Without one the outcome is a forfeit, which the learner can still appeal.",
      "not_eligible",
    );
  }

  if (parsed.outcome === "oral_authorised" && !parsed.note) {
    throw new SupportError(
      "Say what the medical ground was. An oral assessment authorised on an unrecorded reason is the sitting an external verifier asks about.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(missedAssessments)
      .set({
        outcome: parsed.outcome,
        secondMissMedical: parsed.medical ?? false,
        secondMissNote: parsed.note || null,
        updatedAt: new Date(),
      })
      .where(eq(missedAssessments.id, parsed.missedAssessmentId))
      .returning();

    if (!updated) {
      throw new SupportError("That record was not found.", "not_found");
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "support.additional_date_outcome",
      entityType: "missed_assessment",
      entityId: parsed.missedAssessmentId,
      after: { outcome: updated.outcome, medical: updated.secondMissMedical },
    });

    return updated;
  });
}

export async function learnerMissedAssessments(
  session: AuthenticatedSession,
  learnerId: string,
) {
  assertSessionCan(session, "support:act");

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: missedAssessments.id,
        assessmentId: missedAssessments.assessmentId,
        assessmentTitle: assessments.title,
        missedOn: missedAssessments.missedOn,
        missedReason: missedAssessments.missedReason,
        additionalDate: missedAssessments.additionalDate,
        outcome: missedAssessments.outcome,
        secondMissMedical: missedAssessments.secondMissMedical,
        secondMissNote: missedAssessments.secondMissNote,
      })
      .from(missedAssessments)
      .innerJoin(
        assessments,
        eq(assessments.id, missedAssessments.assessmentId),
      )
      .where(eq(missedAssessments.learnerId, learnerId))
      .orderBy(desc(missedAssessments.missedOn)),
  );
}
