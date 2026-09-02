import { asc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  cohortMembers,
  cohorts,
  eisaSittings,
  enrolments,
  organisations,
  qualifications,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { qualificationReadiness } from "./eisa";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { addWorkingDays } from "./working-days";

/**
 * Entering learners for the external assessment.
 *
 * Two things the client currently does by hand and gets wrong in the same way
 * every time: knowing when registration closes, and assembling the list.
 *
 * The dates live in an email from the assessment quality partner. Registration
 * for a sitting closes about three months ahead, so a cohort finishing in
 * November is entered for a sitting whose deadline passed in August, and the
 * first anybody knows is when the deadline has gone. Holding the sittings here
 * turns that into a countdown somebody can see.
 *
 * The list is assembled from the criterion ledger rather than typed, so it
 * cannot include somebody who is not actually ready - which is the other
 * failure, and the expensive one, because an entry fee is paid per candidate.
 */

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "invalid" | "closed" | "nobody_ready",
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

const sittingInput = z.object({
  name: z.string().trim().min(3).max(200),
  qualificationId: z.string().uuid().optional(),
  sittingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  registrationCloses: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assessmentQualityPartner: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function recordEisaSitting(
  session: AuthenticatedSession,
  input: z.input<typeof sittingInput>,
) {
  assertSessionCan(session, "enrolment:manage");
  const parsed = sittingInput.parse(input);

  if (parsed.registrationCloses > parsed.sittingDate) {
    throw new RegistrationError(
      "Registration cannot close after the sitting it is for.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(eisaSittings)
      .values({
        organisationId: session.organisationId,
        qualificationId: parsed.qualificationId ?? null,
        name: parsed.name,
        sittingDate: parsed.sittingDate,
        registrationCloses: parsed.registrationCloses,
        assessmentQualityPartner: parsed.assessmentQualityPartner || null,
        note: parsed.note || null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "eisa.sitting_recorded",
      entityType: "eisa_sitting",
      entityId: created.id,
      after: {
        name: created.name,
        sittingDate: created.sittingDate,
        registrationCloses: created.registrationCloses,
      },
    });

    return created;
  });
}

/**
 * Sittings still open for registration, soonest deadline first.
 *
 * A sitting whose registration has closed is dropped rather than shown greyed
 * out: it is no longer a thing anybody can act on, and leaving it on the list
 * makes the next real deadline one row further down.
 */
export async function upcomingSittings(
  session: AuthenticatedSession,
  asAt: string,
) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: eisaSittings.id,
        name: eisaSittings.name,
        qualificationId: eisaSittings.qualificationId,
        qualificationTitle: qualifications.title,
        sittingDate: eisaSittings.sittingDate,
        registrationCloses: eisaSittings.registrationCloses,
        assessmentQualityPartner: eisaSittings.assessmentQualityPartner,
        note: eisaSittings.note,
      })
      .from(eisaSittings)
      .leftJoin(
        qualifications,
        eq(qualifications.id, eisaSittings.qualificationId),
      )
      .where(gte(eisaSittings.registrationCloses, asAt))
      .orderBy(asc(eisaSittings.registrationCloses)),
  );
}

export type RegistrationCandidate = {
  userId: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  email: string;
  ready: boolean;
  percent: number;
  outstanding: number;
};

/**
 * Who on a cohort could be entered, and who could not.
 *
 * Both, deliberately. A list of only the ready ones answers "who do I enter"
 * and hides the more useful question, which is who is one criterion short and
 * could still make the deadline if somebody moved.
 *
 * Readiness is read from the criterion ledger, so it counts a module
 * recognised through prior learning exactly as it counts one that was taught -
 * and an entry fee is not paid for somebody who is not actually ready.
 */
export async function registrationList(
  session: AuthenticatedSession,
  cohortId: string,
): Promise<{
  cohortName: string;
  qualificationTitle: string | null;
  candidates: RegistrationCandidate[];
}> {
  assertSessionCan(session, "enrolment:read_all");

  const context = await withTenant(session.organisationId, async (tx) => {
    const [found] = await tx
      .select({ id: cohorts.id, name: cohorts.name })
      .from(cohorts)
      .where(eq(cohorts.id, cohortId));

    if (!found) throw new RegistrationError("Cohort not found.", "not_found");

    // The qualification hangs off the enrolment rather than the cohort, since
    // an enrolment is what counts towards an award. Taken from the cohort's
    // members, which is the only place the two meet.
    const [enrolled] = await tx
      .selectDistinct({
        qualificationId: enrolments.qualificationId,
        qualificationTitle: qualifications.title,
      })
      .from(cohortMembers)
      .innerJoin(enrolments, eq(enrolments.userId, cohortMembers.userId))
      .innerJoin(
        qualifications,
        eq(qualifications.id, enrolments.qualificationId),
      )
      .where(eq(cohortMembers.cohortId, cohortId));

    const cohort = {
      id: found.id,
      name: found.name,
      qualificationId: enrolled?.qualificationId ?? null,
      qualificationTitle: enrolled?.qualificationTitle ?? null,
    };

    const members = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        nationalId: users.nationalId,
        email: users.email,
      })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(eq(cohortMembers.cohortId, cohortId))
      .orderBy(users.lastName, users.firstName);

    return { cohort, members };
  });

  if (!context.cohort.qualificationId) {
    return {
      cohortName: context.cohort.name,
      qualificationTitle: context.cohort.qualificationTitle,
      candidates: context.members.map((member) => ({
        ...member,
        ready: false,
        percent: 0,
        outstanding: 0,
      })),
    };
  }

  const candidates: RegistrationCandidate[] = [];
  for (const member of context.members) {
    const readiness = await qualificationReadiness(
      session,
      context.cohort.qualificationId,
      member.userId,
    );

    candidates.push({
      ...member,
      ready: readiness.eisaEligible,
      percent: readiness.readinessIndex,
      outstanding: readiness.outstanding.length,
    });
  }

  return {
    cohortName: context.cohort.name,
    qualificationTitle: context.cohort.qualificationTitle,
    candidates,
  };
}

/**
 * The registration list as a CSV, for the assessment quality partner.
 *
 * Only those actually ready. The unready ones are useful on screen, where
 * somebody can act on them, and are noise in a file that goes to the AQP.
 *
 * The identity number is included because every AQP asks for it and a
 * registration returned for a missing one costs a cycle. Where it is absent the
 * cell says so in words rather than being blank, so the gap is visible before
 * the file is sent rather than after.
 */
export function registrationCsv(input: {
  providerName: string;
  accreditationNumber: string | null;
  cohortName: string;
  qualificationTitle: string | null;
  sittingName: string;
  sittingDate: string;
  candidates: RegistrationCandidate[];
}): string {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const rows: string[][] = [
    ["Provider", input.providerName],
    ["Accreditation number", input.accreditationNumber ?? "NOT RECORDED"],
    ["Qualification", input.qualificationTitle ?? "NOT RECORDED"],
    ["Cohort", input.cohortName],
    ["Sitting", `${input.sittingName} (${input.sittingDate})`],
    [],
    ["Surname", "First name", "Identity number", "Email"],
  ];

  for (const candidate of input.candidates.filter((row) => row.ready)) {
    rows.push([
      candidate.lastName,
      candidate.firstName,
      candidate.nationalId ?? "NOT RECORDED",
      candidate.email,
    ]);
  }

  return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

/**
 * Cohorts whose learners are ready, or nearly, against a closing deadline.
 *
 * The countdown. Working days rather than calendar days for the warning
 * threshold, because a deadline ten days out over a long weekend is nearer
 * than it looks.
 */
export async function registrationDue(
  session: AuthenticatedSession,
  asAt: string,
) {
  assertSessionCan(session, "enrolment:read_all");

  const sittings = await upcomingSittings(session, asAt);
  if (sittings.length === 0) return [];

  const running = await withTenant(session.organisationId, async (tx) =>
    tx
      .selectDistinct({
        id: cohorts.id,
        name: cohorts.name,
        qualificationId: enrolments.qualificationId,
        eisaRegistrationDate: cohorts.eisaRegistrationDate,
      })
      .from(cohorts)
      .leftJoin(cohortMembers, eq(cohortMembers.cohortId, cohorts.id))
      .leftJoin(enrolments, eq(enrolments.userId, cohortMembers.userId))
      .where(inArray(cohorts.status, ["running", "planned"])),
  );

  // Ten working days is the point at which somebody has to start rather than
  // intend to. Earlier than that and a warning is noise; later and there is
  // not time to chase an identity number.
  const soon = addWorkingDays(asAt, 10);

  return sittings.flatMap((sitting) =>
    running
      .filter(
        (cohort) =>
          sitting.qualificationId === null ||
          cohort.qualificationId === sitting.qualificationId,
      )
      .filter((cohort) => !cohort.eisaRegistrationDate)
      .map((cohort) => ({
        sittingId: sitting.id,
        sittingName: sitting.name,
        sittingDate: sitting.sittingDate,
        registrationCloses: sitting.registrationCloses,
        cohortId: cohort.id,
        cohortName: cohort.name,
        urgent: sitting.registrationCloses <= soon,
      })),
  );
}

/** The provider's own details, for the header of a registration file. */
export async function providerDetails(session: AuthenticatedSession) {
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        legalName: organisations.legalName,
        accreditationNumber: organisations.accreditationNumber,
      })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    return row ?? { legalName: "", accreditationNumber: null };
  });
}
