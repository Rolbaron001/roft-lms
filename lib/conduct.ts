import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  attendanceRecords,
  cohortSessions,
  disciplinaryCases,
  disciplinaryHearings,
  disciplinaryWarnings,
  grievances,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { dateInZone } from "./timezone";
import { addWorkingDays } from "./working-days";

/**
 * Learner discipline, abscondment and grievances.
 *
 * The procedure is long and most of it is people talking to each other, which
 * a platform has no business running. What it holds is the part that has to be
 * provable afterwards: what the learner was accused of, which warnings were
 * live at the time, whether notice of a hearing was adequate, what was decided
 * and when the learner was told.
 *
 * That is not an arbitrary list. It is what a sponsor's complaint or a CCMA
 * referral asks for, in the order it happened, and it is exactly what a folder
 * of emails cannot produce.
 *
 * Three rules refuse rather than warn, and each of them is a procedural defect
 * that would cost the provider the case regardless of what the learner did.
 */

export class ConductError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "invalid"
      | "short_notice"
      | "needs_hearing"
      | "not_impartial"
      | "closed",
  ) {
    super(message);
    this.name = "ConductError";
  }
}

/** Minimum hours between giving notice of a hearing and holding it. */
export const HEARING_NOTICE_HOURS = 48;

/** Working days a learner has to appeal a disciplinary outcome. */
export const DAYS_TO_APPEAL_SANCTION = 5;

/** Working days to acknowledge a grievance. */
export const DAYS_TO_ACKNOWLEDGE_GRIEVANCE = 2;

/** Working days from the grievance meeting to a written decision. */
export const DAYS_TO_DECIDE_GRIEVANCE = 10;

/**
 * How long a warning counts, by grade.
 *
 * Months rather than a single number, because a verbal warning for lateness
 * should not still be escalating somebody a year later while a final written
 * warning for theft plainly should. A tenant with its own policy changes these
 * three numbers and nothing else.
 */
export const WARNING_VALIDITY_MONTHS: Record<string, number> = {
  verbal: 3,
  written: 6,
  final_written: 12,
};

/** Consecutive training days absent with no word before it is abscondment. */
export const ABSCONDMENT_DAYS = 2;

// ---------------------------------------------------------------------------
// Opening a case
// ---------------------------------------------------------------------------

const caseInput = z.object({
  learnerId: z.string().uuid(),
  cohortId: z.string().uuid().optional(),
  grade: z.enum(["minor", "serious", "gross"]),
  allegation: z
    .string()
    .trim()
    .min(
      15,
      "Say what is alleged, specifically. A learner cannot answer 'poor attitude', and neither can a hearing.",
    ),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function openDisciplinaryCase(
  session: AuthenticatedSession,
  input: z.input<typeof caseInput>,
) {
  assertSessionCan(session, "conduct:manage");
  const parsed = caseInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(disciplinaryCases)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        cohortId: parsed.cohortId ?? null,
        grade: parsed.grade,
        allegation: parsed.allegation,
        occurredOn: parsed.occurredOn,
        raisedById: session.userId,
        // Gross misconduct does not pass through counselling. Starting it at
        // the informal stage would misdescribe the case from the first row.
        stage:
          parsed.grade === "gross" ? "hearing" : "informal_counselling",
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "conduct.case_opened",
      entityType: "disciplinary_case",
      entityId: created.id,
      after: {
        learnerId: created.learnerId,
        grade: created.grade,
        occurredOn: created.occurredOn,
      },
    });

    return created;
  });
}

// ---------------------------------------------------------------------------
// Warnings, and what is still live
// ---------------------------------------------------------------------------

/**
 * When a warning stops counting.
 *
 * Pure, so the arithmetic can be tested without a database and so the same
 * function decides both what to store and what to display.
 */
export function warningExpiry(
  kind: "verbal" | "written" | "final_written",
  issuedOn: string,
): string {
  const months = WARNING_VALIDITY_MONTHS[kind] ?? 6;
  const at = new Date(`${issuedOn}T00:00:00Z`);
  const day = at.getUTCDate();
  at.setUTCMonth(at.getUTCMonth() + months);

  // Rolling a month forward from the 31st lands in the following month. Pull
  // it back to the last day of the month intended, so a warning issued on 31
  // August expires on 28 February and not 3 March.
  if (at.getUTCDate() !== day) at.setUTCDate(0);

  return at.toISOString().slice(0, 10);
}

const warningInput = z.object({
  caseId: z.string().uuid(),
  kind: z.enum(["verbal", "written", "final_written"]),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  terms: z
    .string()
    .trim()
    .min(
      20,
      "State the rule broken, the standard expected and what happens if it recurs. A warning that does not is not one.",
    ),
});

export async function issueWarning(
  session: AuthenticatedSession,
  input: z.input<typeof warningInput>,
) {
  assertSessionCan(session, "conduct:manage");
  const parsed = warningInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [matter] = await tx
      .select()
      .from(disciplinaryCases)
      .where(eq(disciplinaryCases.id, parsed.caseId));

    if (!matter) throw new ConductError("Case not found.", "not_found");
    if (matter.closedAt) throw new ConductError("That case is closed.", "closed");

    const [created] = await tx
      .insert(disciplinaryWarnings)
      .values({
        organisationId: session.organisationId,
        caseId: parsed.caseId,
        learnerId: matter.learnerId,
        kind: parsed.kind,
        issuedOn: parsed.issuedOn,
        validUntil: warningExpiry(parsed.kind, parsed.issuedOn),
        terms: parsed.terms,
        issuedById: session.userId,
      })
      .returning();

    await tx
      .update(disciplinaryCases)
      .set({
        stage:
          parsed.kind === "verbal"
            ? "verbal_warning"
            : parsed.kind === "written"
              ? "written_warning"
              : "final_written_warning",
        updatedAt: new Date(),
      })
      .where(eq(disciplinaryCases.id, parsed.caseId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "conduct.warning_issued",
      entityType: "disciplinary_warning",
      entityId: created.id,
      after: {
        learnerId: created.learnerId,
        kind: created.kind,
        validUntil: created.validUntil,
      },
    });

    return created;
  });
}

/** Records the learner's signature of receipt, which the procedure asks for. */
export async function acknowledgeWarning(
  session: AuthenticatedSession,
  warningId: string,
) {
  assertSessionCan(session, "conduct:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(disciplinaryWarnings)
      .set({ acknowledgedAt: new Date() })
      .where(eq(disciplinaryWarnings.id, warningId))
      .returning();

    if (!updated) throw new ConductError("Warning not found.", "not_found");
    return updated;
  });
}

/**
 * The warnings still live against a learner today.
 *
 * The question escalation actually turns on, and the one a folder answers
 * wrongly: a warning from two years ago is in the folder and is not live, and
 * treating it as though it were is the commonest way a disciplinary decision
 * is overturned.
 */
export async function liveWarnings(
  session: AuthenticatedSession,
  learnerId: string,
  asAt: string,
) {
  assertSessionCan(session, "conduct:manage");

  return withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .select({
        id: disciplinaryWarnings.id,
        kind: disciplinaryWarnings.kind,
        issuedOn: disciplinaryWarnings.issuedOn,
        validUntil: disciplinaryWarnings.validUntil,
        terms: disciplinaryWarnings.terms,
        acknowledgedAt: disciplinaryWarnings.acknowledgedAt,
      })
      .from(disciplinaryWarnings)
      .where(eq(disciplinaryWarnings.learnerId, learnerId))
      .orderBy(desc(disciplinaryWarnings.issuedOn));

    return found.map((row) => ({ ...row, live: row.validUntil >= asAt }));
  });
}

// ---------------------------------------------------------------------------
// The hearing, and its notice period
// ---------------------------------------------------------------------------

/**
 * Whether a hearing may be held at the time proposed.
 *
 * Pure and tested against a fixed clock. The procedure says at least 48 hours
 * from notice, and a hearing convened at shorter notice is a procedural defect
 * that loses the provider the case whatever the learner did.
 */
export function noticeIsAdequate(input: {
  noticeGivenAt: Date;
  scheduledFor: Date;
  hours?: number;
}): { adequate: boolean; earliest: Date; shortBySeconds: number } {
  const hours = input.hours ?? HEARING_NOTICE_HOURS;
  const earliest = new Date(
    input.noticeGivenAt.getTime() + hours * 3_600_000,
  );
  const shortBySeconds = Math.max(
    0,
    Math.floor((earliest.getTime() - input.scheduledFor.getTime()) / 1000),
  );

  return {
    adequate: shortBySeconds === 0,
    earliest,
    shortBySeconds,
  };
}

const hearingInput = z.object({
  caseId: z.string().uuid(),
  scheduledFor: z.string().min(10),
  venue: z.string().trim().max(300).optional(),
  meetingUrl: z.string().trim().max(500).optional(),
  allegations: z
    .string()
    .trim()
    .min(
      15,
      "The notice has to state the specific allegations. A hearing about unstated allegations cannot be answered.",
    ),
  sanctionsAdvised: z
    .string()
    .trim()
    .min(
      5,
      "Say what sanctions are possible, including termination where it is. A learner deciding whether to bring assistance needs to know what is at stake.",
    ),
  rightsAdvised: z.boolean(),
});

/**
 * Convenes a hearing.
 *
 * Refuses short notice, refuses a notice that does not state the allegations,
 * and refuses one where the learner has not been told their rights. All three
 * are things somebody arranging a hearing at the end of a difficult week would
 * skip, and all three are what an appeal is won on.
 */
export async function convenehearing(
  session: AuthenticatedSession,
  input: z.input<typeof hearingInput>,
  now: Date = new Date(),
) {
  assertSessionCan(session, "conduct:manage");
  const parsed = hearingInput.parse(input);

  if (!parsed.rightsAdvised) {
    throw new ConductError(
      "The notice must tell the learner they may be assisted by a fellow learner, present their case, and call and question witnesses. Send a notice that does, then record it here.",
      "invalid",
    );
  }

  const scheduledFor = new Date(parsed.scheduledFor);
  if (Number.isNaN(scheduledFor.getTime())) {
    throw new ConductError("That is not a date and time.", "invalid");
  }

  const notice = noticeIsAdequate({ noticeGivenAt: now, scheduledFor });
  if (!notice.adequate) {
    const hours = Math.ceil(notice.shortBySeconds / 3600);
    throw new ConductError(
      `A hearing needs at least ${HEARING_NOTICE_HOURS} hours' notice and this is ${hours} ${hours === 1 ? "hour" : "hours"} short. The earliest it can be held is ${notice.earliest.toISOString().slice(0, 16).replace("T", " ")}. Short notice is the defect an appeal is won on, whatever the learner did.`,
      "short_notice",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [matter] = await tx
      .select()
      .from(disciplinaryCases)
      .where(eq(disciplinaryCases.id, parsed.caseId));

    if (!matter) throw new ConductError("Case not found.", "not_found");
    if (matter.closedAt) throw new ConductError("That case is closed.", "closed");

    const [created] = await tx
      .insert(disciplinaryHearings)
      .values({
        organisationId: session.organisationId,
        caseId: parsed.caseId,
        noticeGivenAt: now,
        scheduledFor,
        venue: parsed.venue || null,
        meetingUrl: parsed.meetingUrl || null,
        allegations: parsed.allegations,
        sanctionsAdvised: parsed.sanctionsAdvised,
        rightsAdvised: true,
      })
      .returning();

    await tx
      .update(disciplinaryCases)
      .set({ stage: "hearing", updatedAt: new Date() })
      .where(eq(disciplinaryCases.id, parsed.caseId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "conduct.hearing_convened",
      entityType: "disciplinary_hearing",
      entityId: created.id,
      after: {
        caseId: created.caseId,
        noticeGivenAt: created.noticeGivenAt,
        scheduledFor: created.scheduledFor,
      },
    });

    return created;
  });
}

export async function recordHearingOutcome(
  session: AuthenticatedSession,
  input: { hearingId: string; chairId?: string; assistedBy?: string; findings: string },
) {
  assertSessionCan(session, "conduct:manage");

  const findings = input.findings.trim();
  if (findings.length < 20) {
    throw new ConductError(
      "Record what was found and on what basis. A hearing whose findings are one line is a hearing that did not happen.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(disciplinaryHearings)
      .set({
        heldAt: new Date(),
        chairId: input.chairId ?? null,
        assistedBy: input.assistedBy || null,
        findings,
      })
      .where(eq(disciplinaryHearings.id, input.hearingId))
      .returning();

    if (!updated) throw new ConductError("Hearing not found.", "not_found");
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Closing a case
// ---------------------------------------------------------------------------

const closeInput = z.object({
  caseId: z.string().uuid(),
  sanction: z.enum([
    "no_action",
    "counselled",
    "verbal_warning",
    "written_warning",
    "final_written_warning",
    "terminated",
    "expelled",
  ]),
  outcomeReason: z
    .string()
    .trim()
    .min(
      20,
      "Say why. An unexplained sanction is indefensible, and this is the paragraph the learner is entitled to.",
    ),
});

/**
 * Closes a case with a sanction.
 *
 * Termination and expulsion refuse without a hearing that was actually held.
 * The procedure allows a termination by agreement with the sponsor and without
 * a hearing, and where that happened it is recorded as a hearing did not occur
 * - so the refusal is the right default and the exception is a conversation
 * somebody has deliberately rather than a step that quietly went missing.
 */
export async function closeDisciplinaryCase(
  session: AuthenticatedSession,
  timeZone: string,
  input: z.input<typeof closeInput>,
) {
  assertSessionCan(session, "conduct:manage");
  const parsed = closeInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [matter] = await tx
      .select()
      .from(disciplinaryCases)
      .where(eq(disciplinaryCases.id, parsed.caseId));

    if (!matter) throw new ConductError("Case not found.", "not_found");
    if (matter.closedAt) throw new ConductError("That case is closed.", "closed");

    const severe =
      parsed.sanction === "terminated" || parsed.sanction === "expelled";

    if (severe) {
      const [hearing] = await tx
        .select({ heldAt: disciplinaryHearings.heldAt })
        .from(disciplinaryHearings)
        .where(eq(disciplinaryHearings.caseId, parsed.caseId));

      if (!hearing?.heldAt) {
        throw new ConductError(
          "Ending somebody's programme needs a hearing that was held, with its findings recorded. Convene one, record what was found, then close the case.",
          "needs_hearing",
        );
      }
    }

    const today = dateInZone(new Date(), timeZone);

    const [updated] = await tx
      .update(disciplinaryCases)
      .set({
        sanction: parsed.sanction,
        outcomeReason: parsed.outcomeReason,
        stage: "closed",
        closedAt: new Date(),
        closedById: session.userId,
        // The right to appeal runs from being told, so the deadline is set when
        // the outcome is recorded and re-set if it is given later.
        appealBy: addWorkingDays(today, DAYS_TO_APPEAL_SANCTION),
        updatedAt: new Date(),
      })
      .where(eq(disciplinaryCases.id, parsed.caseId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "conduct.case_closed",
      entityType: "disciplinary_case",
      entityId: parsed.caseId,
      before: { stage: matter.stage },
      after: { sanction: updated.sanction, appealBy: updated.appealBy },
    });

    return updated;
  });
}

/** Records that the learner has been given the outcome in writing. */
export async function recordOutcomeGiven(
  session: AuthenticatedSession,
  timeZone: string,
  caseId: string,
) {
  assertSessionCan(session, "conduct:manage");

  return withTenant(session.organisationId, async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(disciplinaryCases)
      .set({
        outcomeGivenAt: now,
        // Re-set from the day they were actually told. A learner told a week
        // late has not had five working days from the decision.
        appealBy: addWorkingDays(
          dateInZone(now, timeZone),
          DAYS_TO_APPEAL_SANCTION,
        ),
        updatedAt: now,
      })
      .where(eq(disciplinaryCases.id, caseId))
      .returning();

    if (!updated) throw new ConductError("Case not found.", "not_found");
    return updated;
  });
}

export async function learnerCases(
  session: AuthenticatedSession,
  learnerId: string,
) {
  assertSessionCan(session, "conduct:manage");

  return withTenant(session.organisationId, async (tx) => {
    const cases = await tx
      .select()
      .from(disciplinaryCases)
      .where(eq(disciplinaryCases.learnerId, learnerId))
      .orderBy(desc(disciplinaryCases.occurredOn));

    if (cases.length === 0) return [];

    const hearings = await tx
      .select()
      .from(disciplinaryHearings)
      .where(
        inArray(
          disciplinaryHearings.caseId,
          cases.map((row) => row.id),
        ),
      );

    const warnings = await tx
      .select()
      .from(disciplinaryWarnings)
      .where(
        inArray(
          disciplinaryWarnings.caseId,
          cases.map((row) => row.id),
        ),
      );

    return cases.map((row) => ({
      ...row,
      hearing: hearings.find((h) => h.caseId === row.id) ?? null,
      warnings: warnings.filter((w) => w.caseId === row.id),
    }));
  });
}

// ---------------------------------------------------------------------------
// Abscondment
// ---------------------------------------------------------------------------

/**
 * Learners absent from consecutive training days with no word.
 *
 * Derived from the attendance register rather than kept as a state, because it
 * is entirely a fact about the register and a stored copy would go stale the
 * moment somebody corrected a mark. The procedure defines abscondment as two
 * consecutive training days without communication; an absence recorded as
 * excused is communication, so it breaks the run.
 *
 * What this produces is a list to act on, never a decision. Contacting the
 * learner, writing to the sponsor and issuing a notice of intention to
 * terminate are all things a person does.
 */
export async function possibleAbscondment(
  session: AuthenticatedSession,
  cohortId: string,
  days: number = ABSCONDMENT_DAYS,
) {
  assertSessionCan(session, "conduct:manage");

  return withTenant(session.organisationId, async (tx) => {
    const marks = await tx
      .select({
        userId: attendanceRecords.userId,
        status: attendanceRecords.status,
        date: cohortSessions.scheduledDate,
        kind: cohortSessions.kind,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(attendanceRecords)
      .innerJoin(
        cohortSessions,
        eq(cohortSessions.id, attendanceRecords.sessionId),
      )
      .innerJoin(users, eq(users.id, attendanceRecords.userId))
      .where(eq(cohortSessions.cohortId, cohortId))
      .orderBy(cohortSessions.scheduledDate);

    // The voluntary walk-in is not a training day, so missing it is not a fact
    // about the learner and must not start a run.
    const relevant = marks.filter((row) => row.kind !== "walk_in");

    const byLearner = new Map<string, typeof relevant>();
    for (const row of relevant) {
      const list = byLearner.get(row.userId) ?? [];
      list.push(row);
      byLearner.set(row.userId, list);
    }

    const flagged: {
      userId: string;
      name: string;
      consecutive: number;
      since: string;
    }[] = [];

    for (const [userId, rows] of byLearner) {
      let run = 0;
      let since = "";

      for (const row of rows) {
        // Excused is communication: the learner told somebody. It breaks the
        // run exactly as being present does.
        if (row.status === "absent") {
          if (run === 0) since = row.date;
          run += 1;
        } else {
          run = 0;
          since = "";
        }
      }

      if (run >= days) {
        flagged.push({
          userId,
          name: `${rows[0].firstName} ${rows[0].lastName}`,
          consecutive: run,
          since,
        });
      }
    }

    return flagged.sort((a, b) => b.consecutive - a.consecutive);
  });
}

// ---------------------------------------------------------------------------
// Grievances
// ---------------------------------------------------------------------------

const grievanceInput = z.object({
  learnerId: z.string().uuid(),
  cohortId: z.string().uuid().optional(),
  informalAttempted: z.boolean().optional(),
  nature: z
    .string()
    .trim()
    .min(20, "Say what the grievance is about, in the learner's own words where possible."),
  individualsInvolved: z.string().trim().max(500).optional(),
  occurredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  desiredOutcome: z.string().trim().max(1000).optional(),
});

export async function lodgeGrievance(
  session: AuthenticatedSession,
  timeZone: string,
  input: z.input<typeof grievanceInput>,
) {
  assertSessionCan(session, "grievance:lodge");
  const parsed = grievanceInput.parse(input);
  const today = dateInZone(new Date(), timeZone);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(grievances)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        cohortId: parsed.cohortId ?? null,
        informalAttempted: parsed.informalAttempted ?? false,
        nature: parsed.nature,
        individualsInvolved: parsed.individualsInvolved || null,
        occurredOn: parsed.occurredOn ?? null,
        desiredOutcome: parsed.desiredOutcome || null,
        lodgedOn: today,
        acknowledgeBy: addWorkingDays(today, DAYS_TO_ACKNOWLEDGE_GRIEVANCE),
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "grievance.lodged",
      entityType: "grievance",
      entityId: created.id,
      after: { learnerId: created.learnerId, acknowledgeBy: created.acknowledgeBy },
    });

    return created;
  });
}

export async function acknowledgeGrievance(
  session: AuthenticatedSession,
  grievanceId: string,
) {
  assertSessionCan(session, "grievance:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(grievances)
      .set({ acknowledgedAt: new Date(), status: "acknowledged", updatedAt: new Date() })
      .where(eq(grievances.id, grievanceId))
      .returning();

    if (!updated) throw new ConductError("Grievance not found.", "not_found");
    return updated;
  });
}

/**
 * Appoints the person who will investigate.
 *
 * Refuses to appoint somebody the grievance names. "A designated impartial
 * person" is the procedure's own wording, and the failure it guards against
 * happens in exactly the circumstances a small provider finds itself in: few
 * people, everybody busy, and the obvious investigator is the one being
 * complained about.
 *
 * The check is a name match against what the learner wrote, which is coarse. It
 * catches the case that matters and will occasionally ask somebody to confirm a
 * coincidence, which is the right way round.
 */
export async function appointInvestigator(
  session: AuthenticatedSession,
  input: { grievanceId: string; investigatorId: string },
) {
  assertSessionCan(session, "grievance:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [matter] = await tx
      .select()
      .from(grievances)
      .where(eq(grievances.id, input.grievanceId));

    if (!matter) throw new ConductError("Grievance not found.", "not_found");

    if (input.investigatorId === matter.learnerId) {
      throw new ConductError(
        "The learner cannot investigate their own grievance.",
        "not_impartial",
      );
    }

    const [person] = await tx
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, input.investigatorId));

    if (!person) throw new ConductError("That person was not found.", "not_found");

    const named = (matter.individualsInvolved ?? "").toLowerCase();
    const full = `${person.firstName} ${person.lastName}`.toLowerCase();

    if (named && (named.includes(full) || named.includes(person.lastName.toLowerCase()))) {
      throw new ConductError(
        `The grievance names ${person.firstName} ${person.lastName}. Somebody the complaint is about cannot investigate it - the procedure asks for a designated impartial person. Appoint somebody else.`,
        "not_impartial",
      );
    }

    const [updated] = await tx
      .update(grievances)
      .set({
        investigatorId: input.investigatorId,
        status: "under_investigation",
        updatedAt: new Date(),
      })
      .where(eq(grievances.id, input.grievanceId))
      .returning();

    return updated;
  });
}

export async function decideGrievance(
  session: AuthenticatedSession,
  timeZone: string,
  input: { grievanceId: string; meetingHeldOn: string; decision: string },
) {
  assertSessionCan(session, "grievance:manage");

  const decision = input.decision.trim();
  if (decision.length < 20) {
    throw new ConductError(
      "The decision goes to the learner in writing and has to say what was found and what will be done. A line is not a decision.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const today = dateInZone(new Date(), timeZone);

    const [updated] = await tx
      .update(grievances)
      .set({
        meetingHeldOn: input.meetingHeldOn,
        decidedOn: today,
        decisionDueBy: addWorkingDays(input.meetingHeldOn, DAYS_TO_DECIDE_GRIEVANCE),
        decision,
        decisionGivenAt: new Date(),
        status: "decided",
        updatedAt: new Date(),
      })
      .where(eq(grievances.id, input.grievanceId))
      .returning();

    if (!updated) throw new ConductError("Grievance not found.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "grievance.decided",
      entityType: "grievance",
      entityId: input.grievanceId,
      after: { decidedOn: updated.decidedOn, dueBy: updated.decisionDueBy },
    });

    return updated;
  });
}

export async function openGrievances(session: AuthenticatedSession) {
  assertSessionCan(session, "grievance:manage");

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: grievances.id,
        learnerId: grievances.learnerId,
        firstName: users.firstName,
        lastName: users.lastName,
        nature: grievances.nature,
        lodgedOn: grievances.lodgedOn,
        acknowledgeBy: grievances.acknowledgeBy,
        acknowledgedAt: grievances.acknowledgedAt,
        status: grievances.status,
        decisionDueBy: grievances.decisionDueBy,
      })
      .from(grievances)
      .innerJoin(users, eq(users.id, grievances.learnerId))
      .where(
        inArray(grievances.status, [
          "lodged",
          "acknowledged",
          "under_investigation",
          "decided",
          "appealed",
        ]),
      )
      .orderBy(grievances.acknowledgeBy),
  );
}

export async function learnerGrievances(
  session: AuthenticatedSession,
  learnerId: string,
) {
  if (learnerId !== session.userId) {
    assertSessionCan(session, "grievance:manage");
  }

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select()
      .from(grievances)
      .where(eq(grievances.learnerId, learnerId))
      .orderBy(desc(grievances.lodgedOn)),
  );
}
