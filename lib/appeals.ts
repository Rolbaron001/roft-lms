import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  appealNotes,
  appeals,
  assessmentSubmissions,
  assessments,
  cohortMembers,
  cohorts,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { dateInZone } from "./timezone";
import { withinWorkingDays } from "./working-days";

/**
 * Appeals.
 *
 * A learner may appeal against a result or against an assessor's conduct. The
 * two look alike on the way in and diverge immediately: a result appeal is
 * settled by the internal moderator re-examining the judgement, and a conduct
 * appeal is not something re-marking can settle at all.
 *
 * The procedure is specific about time in a way most of the client's
 * procedures are not. The learner has two working days from receiving the
 * result or from the incident. The assessor acknowledges within two hours.
 * That second clock is the interesting one: it runs while somebody is
 * teaching, it is the one that gets missed, and nobody ever finds out it was
 * missed because the evidence of an acknowledgement is an email that was or
 * was not sent.
 *
 * So the acknowledgement is a recorded act with a time on it, and the platform
 * can be asked which appeals are past two hours and unacknowledged. That
 * question is the whole reason this is not a spreadsheet.
 */

export class AppealError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "not_a_member"
      | "invalid"
      | "out_of_time"
      | "already_acknowledged"
      | "needs_moderator"
      | "already_resolved"
      | "closed",
  ) {
    super(message);
    this.name = "AppealError";
  }
}

/** Working days the learner has to lodge, from the result or the incident. */
export const DAYS_TO_LODGE = 2;

/**
 * Hours the assessor has to acknowledge receipt.
 *
 * Two, from the client's procedure. Held as a number rather than written into
 * a comparison so that a tenant whose own procedure says four is a change to
 * one line, and so that the number in the overdue report and the number in the
 * rule cannot drift apart.
 */
export const HOURS_TO_ACKNOWLEDGE = 2;

// ---------------------------------------------------------------------------
// Lodging
// ---------------------------------------------------------------------------

const lodgeInput = z.object({
  learnerId: z.string().uuid(),
  cohortId: z.string().uuid(),
  ground: z.enum(["result", "assessor_conduct"]),
  assessmentId: z.string().uuid().optional(),
  triggeredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date as a date."),
  statement: z
    .string()
    .trim()
    .min(20, "Say what the appeal is about. One line is not an appeal."),
  lateAcceptanceReason: z.string().trim().max(2000).optional(),
});

export type LodgeAppealInput = z.input<typeof lodgeInput>;

/**
 * Records an appeal.
 *
 * Deliberately does not refuse a late one. A learner who appeals on the third
 * working day has still appealed, and a platform that turns them away sends
 * the whole matter back into an inbox where nobody can audit it. What it
 * refuses is accepting a late appeal *silently*: somebody has to say why it
 * was accepted, and that reason becomes part of the file. The provider keeps
 * the discretion the procedure gives it; what it loses is the ability to use
 * that discretion without leaving a trace.
 */
export async function lodgeAppeal(
  session: AuthenticatedSession,
  timeZone: string,
  input: LodgeAppealInput,
) {
  assertSessionCan(session, "appeal:lodge");
  const parsed = lodgeInput.parse(input);

  if (parsed.ground === "result" && !parsed.assessmentId) {
    throw new AppealError(
      "Say which assessment the result belongs to. A result appeal that does not name one cannot be sent to a moderator.",
      "invalid",
    );
  }

  const today = dateInZone(new Date(), timeZone);
  const timing = withinWorkingDays({
    from: parsed.triggeredOn,
    done: today,
    count: DAYS_TO_LODGE,
  });

  if (!timing.inTime && !parsed.lateAcceptanceReason) {
    throw new AppealError(
      `This is ${timing.lateByWorkingDays} working ${timing.lateByWorkingDays === 1 ? "day" : "days"} past the deadline of ${timing.deadline}. It can still be lodged, but say why it is being accepted out of time - that reason is part of the record.`,
      "out_of_time",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    // The cohort is how these are filed and reported, so an appeal against a
    // cohort the learner is not on would file itself somewhere nobody looks.
    const [membership] = await tx
      .select({ id: cohortMembers.id })
      .from(cohortMembers)
      .where(
        and(
          eq(cohortMembers.cohortId, parsed.cohortId),
          eq(cohortMembers.userId, parsed.learnerId),
        ),
      );

    if (!membership) {
      throw new AppealError(
        "That learner is not on that cohort.",
        "not_a_member",
      );
    }

    const [created] = await tx
      .insert(appeals)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        cohortId: parsed.cohortId,
        ground: parsed.ground,
        assessmentId: parsed.assessmentId ?? null,
        triggeredOn: parsed.triggeredOn,
        lodgedOn: today,
        lodgedById: session.userId,
        statement: parsed.statement,
        lateAcceptanceReason: timing.inTime
          ? null
          : (parsed.lateAcceptanceReason ?? null),
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "appeal.lodged",
      entityType: "appeal",
      entityId: created.id,
      after: {
        learnerId: created.learnerId,
        cohortId: created.cohortId,
        ground: created.ground,
        triggeredOn: created.triggeredOn,
        lodgedOn: created.lodgedOn,
        inTime: timing.inTime,
      },
    });

    return created;
  });
}

// ---------------------------------------------------------------------------
// The two-hour clock
// ---------------------------------------------------------------------------

/**
 * Whether an acknowledgement is still owed, and how overdue it is.
 *
 * Pure, so the rule can be tested against a fixed clock rather than whatever
 * the machine running the tests believes the time to be.
 */
export function acknowledgementDue(input: {
  lodgedAt: Date;
  acknowledgedAt: Date | null;
  now: Date;
  hours?: number;
}): { due: boolean; dueAt: Date; overdueBySeconds: number } {
  const hours = input.hours ?? HOURS_TO_ACKNOWLEDGE;
  const dueAt = new Date(input.lodgedAt.getTime() + hours * 3_600_000);

  if (input.acknowledgedAt) {
    return { due: false, dueAt, overdueBySeconds: 0 };
  }

  const overdueBySeconds = Math.max(
    0,
    Math.floor((input.now.getTime() - dueAt.getTime()) / 1000),
  );

  return { due: true, dueAt, overdueBySeconds };
}

/**
 * Stops the two-hour clock.
 *
 * Refuses a second acknowledgement rather than overwriting the first. The time
 * on the first one is the evidence, and an acknowledgement that can be
 * re-stamped is not evidence of anything.
 */
export async function acknowledgeAppeal(
  session: AuthenticatedSession,
  appealId: string,
) {
  assertSessionCan(session, "appeal:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(appeals)
      .where(eq(appeals.id, appealId));

    if (!before) throw new AppealError("Appeal not found.", "not_found");
    if (before.acknowledgedAt) {
      throw new AppealError(
        "This was already acknowledged. The first acknowledgement is the one the record keeps.",
        "already_acknowledged",
      );
    }
    if (before.status === "withdrawn" || before.status === "resolved") {
      throw new AppealError("This appeal is closed.", "closed");
    }

    const [updated] = await tx
      .update(appeals)
      .set({
        acknowledgedAt: new Date(),
        acknowledgedById: session.userId,
        status: "acknowledged",
        updatedAt: new Date(),
      })
      .where(eq(appeals.id, appealId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "appeal.acknowledged",
      entityType: "appeal",
      entityId: appealId,
      before: { acknowledgedAt: null },
      after: { acknowledgedAt: updated.acknowledgedAt },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Working it
// ---------------------------------------------------------------------------

const progressInput = z.object({
  appealId: z.string().uuid(),
  metLearnerOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  moderatorId: z.string().uuid().optional(),
});

/**
 * Records the steps between acknowledgement and outcome: the meeting with the
 * learner, and the moderator consulted.
 */
export async function recordAppealProgress(
  session: AuthenticatedSession,
  input: z.input<typeof progressInput>,
) {
  assertSessionCan(session, "appeal:manage");
  const parsed = progressInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(appeals)
      .where(eq(appeals.id, parsed.appealId));

    if (!before) throw new AppealError("Appeal not found.", "not_found");
    if (before.status === "resolved" || before.status === "withdrawn") {
      throw new AppealError("This appeal is closed.", "closed");
    }

    const [updated] = await tx
      .update(appeals)
      .set({
        metLearnerOn: parsed.metLearnerOn ?? before.metLearnerOn,
        moderatorId: parsed.moderatorId ?? before.moderatorId,
        moderatorConsultedAt: parsed.moderatorId
          ? new Date()
          : before.moderatorConsultedAt,
        status: "under_review",
        updatedAt: new Date(),
      })
      .where(eq(appeals.id, parsed.appealId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "appeal.progressed",
      entityType: "appeal",
      entityId: parsed.appealId,
      before: {
        metLearnerOn: before.metLearnerOn,
        moderatorId: before.moderatorId,
      },
      after: {
        metLearnerOn: updated.metLearnerOn,
        moderatorId: updated.moderatorId,
      },
    });

    return updated;
  });
}

const resolveInput = z.object({
  appealId: z.string().uuid(),
  outcome: z.enum(["upheld", "partially_upheld", "dismissed"]),
  outcomeReason: z
    .string()
    .trim()
    .min(20, "Say why. An outcome with no reasoning is not a resolution, and it is the part the learner is entitled to."),
});

/**
 * Closes an appeal.
 *
 * A result appeal cannot be resolved until the internal moderator has been
 * consulted. That is the step the procedure turns on and the one an external
 * verifier asks about, and a coordinator under pressure at the end of a term
 * is exactly who would skip it. A warning would be clicked past; this refuses.
 *
 * A conduct appeal has no such requirement, because there is no judgement for
 * a moderator to re-examine. Requiring one there would teach people to name a
 * moderator who did nothing, which is worse than not asking.
 */
export async function resolveAppeal(
  session: AuthenticatedSession,
  input: z.input<typeof resolveInput>,
) {
  assertSessionCan(session, "appeal:manage");
  const parsed = resolveInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(appeals)
      .where(eq(appeals.id, parsed.appealId));

    if (!before) throw new AppealError("Appeal not found.", "not_found");
    if (before.status === "resolved") {
      throw new AppealError("This appeal is already resolved.", "already_resolved");
    }
    if (before.status === "withdrawn") {
      throw new AppealError("This appeal was withdrawn.", "closed");
    }

    if (before.ground === "result" && !before.moderatorId) {
      throw new AppealError(
        "A result appeal goes to the internal moderator before it is resolved. Record who was consulted first.",
        "needs_moderator",
      );
    }

    const [updated] = await tx
      .update(appeals)
      .set({
        outcome: parsed.outcome,
        outcomeReason: parsed.outcomeReason,
        status: "resolved",
        resolvedAt: new Date(),
        resolvedById: session.userId,
        updatedAt: new Date(),
      })
      .where(eq(appeals.id, parsed.appealId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "appeal.resolved",
      entityType: "appeal",
      entityId: parsed.appealId,
      before: { status: before.status },
      after: { status: "resolved", outcome: updated.outcome },
    });

    return updated;
  });
}

/**
 * Records that the learner has actually been told the outcome.
 *
 * Its own act, because a resolved appeal the learner has not heard about is
 * the complaint that follows the complaint.
 */
export async function recordLearnerInformed(
  session: AuthenticatedSession,
  appealId: string,
) {
  assertSessionCan(session, "appeal:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(appeals)
      .where(eq(appeals.id, appealId));

    if (!before) throw new AppealError("Appeal not found.", "not_found");
    if (before.status !== "resolved") {
      throw new AppealError(
        "There is no outcome to give the learner yet.",
        "invalid",
      );
    }

    const [updated] = await tx
      .update(appeals)
      .set({ learnerInformedAt: new Date(), updatedAt: new Date() })
      .where(eq(appeals.id, appealId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "appeal.learner_informed",
      entityType: "appeal",
      entityId: appealId,
      after: { learnerInformedAt: updated.learnerInformedAt },
    });

    return updated;
  });
}

const withdrawInput = z.object({
  appealId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(5, "Say why it was withdrawn. A withdrawal with no reason looks like pressure."),
});

export async function withdrawAppeal(
  session: AuthenticatedSession,
  input: z.input<typeof withdrawInput>,
) {
  assertSessionCan(session, "appeal:manage");
  const parsed = withdrawInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(appeals)
      .where(eq(appeals.id, parsed.appealId));

    if (!before) throw new AppealError("Appeal not found.", "not_found");
    if (before.status === "resolved") {
      throw new AppealError(
        "This appeal is already resolved. It cannot be withdrawn afterwards.",
        "already_resolved",
      );
    }

    const [updated] = await tx
      .update(appeals)
      .set({
        status: "withdrawn",
        withdrawnAt: new Date(),
        withdrawnReason: parsed.reason,
        updatedAt: new Date(),
      })
      .where(eq(appeals.id, parsed.appealId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "appeal.withdrawn",
      entityType: "appeal",
      entityId: parsed.appealId,
      before: { status: before.status },
      after: { status: "withdrawn", reason: parsed.reason },
    });

    return updated;
  });
}

export async function addAppealNote(
  session: AuthenticatedSession,
  input: { appealId: string; note: string; visibleToLearner?: boolean },
) {
  assertSessionCan(session, "appeal:manage");

  const note = input.note.trim();
  if (note.length < 3) {
    throw new AppealError("An empty note is worse than none.", "invalid");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(appealNotes)
      .values({
        organisationId: session.organisationId,
        appealId: input.appealId,
        authorId: session.userId,
        note,
        visibleToLearner: input.visibleToLearner ?? false,
      })
      .returning();

    return created;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type AppealRow = {
  id: string;
  learnerId: string;
  learnerName: string;
  cohortId: string;
  cohortName: string;
  ground: "result" | "assessor_conduct";
  assessmentTitle: string | null;
  triggeredOn: string;
  lodgedOn: string;
  lodgedAt: Date;
  statement: string;
  lateAcceptanceReason: string | null;
  status: "lodged" | "acknowledged" | "under_review" | "resolved" | "withdrawn";
  acknowledgedAt: Date | null;
  metLearnerOn: string | null;
  moderatorId: string | null;
  moderatorName: string | null;
  outcome: "upheld" | "partially_upheld" | "dismissed" | null;
  outcomeReason: string | null;
  resolvedAt: Date | null;
  learnerInformedAt: Date | null;
  withdrawnReason: string | null;
};

async function rows(
  session: AuthenticatedSession,
  where: SQL | undefined,
): Promise<AppealRow[]> {
  return withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .select({
        id: appeals.id,
        learnerId: appeals.learnerId,
        learnerFirstName: users.firstName,
        learnerLastName: users.lastName,
        cohortId: appeals.cohortId,
        cohortName: cohorts.name,
        ground: appeals.ground,
        assessmentTitle: assessments.title,
        triggeredOn: appeals.triggeredOn,
        lodgedOn: appeals.lodgedOn,
        lodgedAt: appeals.lodgedAt,
        statement: appeals.statement,
        lateAcceptanceReason: appeals.lateAcceptanceReason,
        status: appeals.status,
        acknowledgedAt: appeals.acknowledgedAt,
        metLearnerOn: appeals.metLearnerOn,
        moderatorId: appeals.moderatorId,
        outcome: appeals.outcome,
        outcomeReason: appeals.outcomeReason,
        resolvedAt: appeals.resolvedAt,
        learnerInformedAt: appeals.learnerInformedAt,
        withdrawnReason: appeals.withdrawnReason,
      })
      .from(appeals)
      .innerJoin(users, eq(users.id, appeals.learnerId))
      .innerJoin(cohorts, eq(cohorts.id, appeals.cohortId))
      .leftJoin(assessments, eq(assessments.id, appeals.assessmentId))
      .where(where)
      .orderBy(desc(appeals.lodgedAt));

    // The moderator's name in a second pass rather than a second join on the
    // same table, which reads worse than it looks.
    const moderatorIds = found
      .map((row) => row.moderatorId)
      .filter((id): id is string => id !== null);

    const names = new Map<string, string>();
    if (moderatorIds.length > 0) {
      const moderators = await tx
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(users)
        .where(inArray(users.id, moderatorIds));
      for (const row of moderators) {
        names.set(row.id, `${row.firstName} ${row.lastName}`);
      }
    }

    return found.map(({ learnerFirstName, learnerLastName, ...row }) => ({
      ...row,
      learnerName: `${learnerFirstName} ${learnerLastName}`,
      moderatorName: row.moderatorId
        ? (names.get(row.moderatorId) ?? null)
        : null,
    }));
  });
}

/** Every appeal on a cohort, which is how the client files them. */
export async function cohortAppeals(
  session: AuthenticatedSession,
  cohortId: string,
): Promise<AppealRow[]> {
  assertSessionCan(session, "appeal:manage");
  return rows(session, eq(appeals.cohortId, cohortId));
}

/** Everything not yet closed, across the tenant. */
export async function openAppeals(
  session: AuthenticatedSession,
): Promise<AppealRow[]> {
  assertSessionCan(session, "appeal:manage");
  return rows(
    session,
    inArray(appeals.status, ["lodged", "acknowledged", "under_review"]),
  );
}

/**
 * The appeals whose two-hour acknowledgement has run out.
 *
 * The report the procedure implies and nobody can produce today. It is the
 * reason the acknowledgement is a recorded act rather than an email.
 */
export async function overdueAcknowledgements(
  session: AuthenticatedSession,
  now: Date = new Date(),
): Promise<(AppealRow & { overdueBySeconds: number })[]> {
  assertSessionCan(session, "appeal:manage");

  const open = await rows(
    session,
    and(
      isNull(appeals.acknowledgedAt),
      inArray(appeals.status, ["lodged", "acknowledged", "under_review"]),
    ),
  );

  return open
    .map((row) => ({
      ...row,
      ...acknowledgementDue({
        lodgedAt: row.lodgedAt,
        acknowledgedAt: row.acknowledgedAt,
        now,
      }),
    }))
    .filter((row) => row.overdueBySeconds > 0)
    .sort((a, b) => b.overdueBySeconds - a.overdueBySeconds);
}

/** A learner's own appeals, for their own page. */
export async function learnerAppeals(
  session: AuthenticatedSession,
  learnerId: string,
): Promise<AppealRow[]> {
  if (learnerId !== session.userId) {
    assertSessionCan(session, "appeal:manage");
  }
  return rows(session, eq(appeals.learnerId, learnerId));
}

export async function appealDetail(
  session: AuthenticatedSession,
  appealId: string,
) {
  assertSessionCan(session, "appeal:manage");

  const [appeal] = await rows(session, eq(appeals.id, appealId));
  if (!appeal) throw new AppealError("Appeal not found.", "not_found");

  const notes = await withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: appealNotes.id,
        note: appealNotes.note,
        visibleToLearner: appealNotes.visibleToLearner,
        createdAt: appealNotes.createdAt,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
      })
      .from(appealNotes)
      .innerJoin(users, eq(users.id, appealNotes.authorId))
      .where(eq(appealNotes.appealId, appealId))
      .orderBy(desc(appealNotes.createdAt)),
  );

  return {
    appeal,
    notes: notes.map(({ authorFirstName, authorLastName, ...note }) => ({
      ...note,
      authorName: `${authorFirstName} ${authorLastName}`,
    })),
  };
}

/**
 * The cohorts a learner is on, for the lodging form.
 *
 * An appeal is filed against a cohort, so the form offers the ones the learner
 * is actually on rather than every cohort in the tenant.
 */
export async function cohortsForLearner(
  session: AuthenticatedSession,
  learnerId: string,
) {
  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({ id: cohorts.id, name: cohorts.name })
      .from(cohortMembers)
      .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
      .where(
        and(
          eq(cohortMembers.userId, learnerId),
          or(eq(cohorts.status, "running"), eq(cohorts.status, "planned")),
        ),
      )
      .orderBy(cohorts.name),
  );
}

/**
 * The assessments a learner could appeal a result on.
 *
 * Only ones they have actually sat. Offering the whole catalogue would let an
 * appeal be filed against an assessment the learner never took, which is a
 * record nobody can act on and a moderator's wasted afternoon.
 */
export async function assessmentsForLearner(
  session: AuthenticatedSession,
  learnerId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .selectDistinct({
        id: assessments.id,
        title: assessments.title,
      })
      .from(assessmentSubmissions)
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentSubmissions.assessmentId),
      )
      .where(eq(assessmentSubmissions.userId, learnerId))
      .orderBy(assessments.title);

    return found;
  });
}
