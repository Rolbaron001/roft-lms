import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  cohortMembers,
  cohorts,
  courseSteps,
  courses,
  enrolments,
  stepReleases,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { enrolUser } from "./enrolment";
import { dayFrom } from "./schedule";

// Re-exported so callers keep one import for everything about a cohort.
export { dayFrom, scheduleForLearner, type ScheduledStep } from "./schedule";

/**
 * Cohorts, and the schedule that hangs off them.
 *
 * A rollout schedule is written the way a person thinks about it — "workbook 3
 * in week four" — and that is how it is held here: as offsets in days from the
 * cohort's start. Dates are computed, never stored. So a delayed intake is one
 * edit to one date rather than forty edits nobody finishes, and a learner who
 * joins late is measured from the same start as everyone else rather than from
 * whenever their record happened to be created.
 */

export class CohortError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "not_permitted" | "invalid",
  ) {
    super(message);
    this.name = "CohortError";
  }
}

export async function createCohort(
  session: AuthenticatedSession,
  input: {
    courseId: string;
    name: string;
    code?: string;
    startDate: string;
    endDate?: string;
    facilitatorId?: string;
  },
) {
  assertSessionCan(session, "enrolment:manage");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) {
    throw new CohortError("Give the start date as YYYY-MM-DD.", "invalid");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx
      .select({ id: courses.id, status: courses.status })
      .from(courses)
      .where(eq(courses.id, input.courseId));

    if (!course) throw new CohortError("No such course.", "not_found");

    const [cohort] = await tx
      .insert(cohorts)
      .values({
        organisationId: session.organisationId,
        courseId: input.courseId,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        facilitatorId: input.facilitatorId ?? null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.created",
      entityType: "cohort",
      entityId: cohort.id,
      after: { name: cohort.name, startDate: cohort.startDate },
    });

    return cohort;
  });
}

/**
 * Moves a cohort's start, and with it every date derived from it.
 *
 * The reason offsets are stored rather than dates: this is one write, and
 * nothing can be left behind holding the old schedule.
 */
export async function rescheduleCohort(
  session: AuthenticatedSession,
  cohortId: string,
  startDate: string,
) {
  assertSessionCan(session, "enrolment:manage");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new CohortError("Give the start date as YYYY-MM-DD.", "invalid");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(cohorts)
      .where(eq(cohorts.id, cohortId));

    if (!before) throw new CohortError("No such cohort.", "not_found");

    const [after] = await tx
      .update(cohorts)
      .set({ startDate, updatedAt: new Date() })
      .where(eq(cohorts.id, cohortId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.rescheduled",
      entityType: "cohort",
      entityId: cohortId,
      before: { startDate: before.startDate },
      after: { startDate: after.startDate },
    });

    return after;
  });
}

/**
 * Adds a learner to a cohort, and enrols them on its course.
 *
 * The two go together deliberately: a member with no enrolment is a name on a
 * register who cannot open anything, which is the kind of half-state that
 * takes a facilitator an afternoon to work out.
 */
export async function addMember(
  session: AuthenticatedSession,
  cohortId: string,
  userId: string,
) {
  assertSessionCan(session, "enrolment:manage");

  const cohort = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!row) throw new CohortError("No such cohort.", "not_found");
    return row;
  });

  if (cohort.status === "cancelled" || cohort.status === "finished") {
    throw new CohortError(
      `That cohort is ${cohort.status}, so nobody further can join it.`,
      "invalid",
    );
  }

  // Somebody re-joining after a break is already enrolled, and enrolling them
  // twice is refused. The cohort is the register; the enrolment is what lets
  // them open anything. Only the missing half is created.
  const alreadyEnrolled = await withTenant(
    session.organisationId,
    async (tx) => {
      const [existing] = await tx
        .select({ id: enrolments.id })
        .from(enrolments)
        .where(
          and(
            eq(enrolments.courseId, cohort.courseId),
            eq(enrolments.userId, userId),
          ),
        );
      return Boolean(existing);
    },
  );

  if (!alreadyEnrolled) {
    await enrolUser(session, { userId, courseId: cohort.courseId });
  }

  return withTenant(session.organisationId, async (tx) => {
    const [member] = await tx
      .insert(cohortMembers)
      .values({
        organisationId: session.organisationId,
        cohortId,
        userId,
      })
      .onConflictDoUpdate({
        target: [cohortMembers.cohortId, cohortMembers.userId],
        // Re-joining clears a previous departure rather than making a second
        // row, so a register never shows the same person twice.
        set: { leftAt: null },
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.member_added",
      entityType: "cohort",
      entityId: cohortId,
      after: { userId },
    });

    return member;
  });
}

export async function removeMember(
  session: AuthenticatedSession,
  cohortId: string,
  userId: string,
) {
  assertSessionCan(session, "enrolment:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [member] = await tx
      .update(cohortMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(cohortMembers.cohortId, cohortId),
          eq(cohortMembers.userId, userId),
          isNull(cohortMembers.leftAt),
        ),
      )
      .returning();

    if (!member) throw new CohortError("They are not on that cohort.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.member_removed",
      entityType: "cohort",
      entityId: cohortId,
      before: { userId },
    });

    return member;
  });
}

/**
 * Writes the rollout schedule: which step opens in which week, and when it is
 * due.
 *
 * Replaces the whole schedule rather than merging into it, because a rollout
 * is edited as one document. Half-applying a new schedule over an old one is
 * how a cohort ends up with two weeks that both think they are week four.
 */
export async function setSchedule(
  session: AuthenticatedSession,
  cohortId: string,
  schedule: {
    stepId: string;
    opensAfterDays?: number | null;
    dueAfterDays?: number | null;
    closesAfterDays?: number | null;
  }[],
) {
  assertSessionCan(session, "enrolment:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx
      .select()
      .from(cohorts)
      .where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortError("No such cohort.", "not_found");

    const steps = await tx
      .select({ id: courseSteps.id })
      .from(courseSteps)
      .where(eq(courseSteps.courseId, cohort.courseId));
    const known = new Set(steps.map((step) => step.id));

    for (const entry of schedule) {
      if (!known.has(entry.stepId)) {
        throw new CohortError(
          "The schedule names a step that is not on this cohort's course.",
          "invalid",
        );
      }
      if (
        entry.opensAfterDays != null &&
        entry.dueAfterDays != null &&
        entry.dueAfterDays < entry.opensAfterDays
      ) {
        throw new CohortError(
          "A step cannot be due before it opens.",
          "invalid",
        );
      }
    }

    await tx.delete(stepReleases).where(eq(stepReleases.cohortId, cohortId));

    if (schedule.length > 0) {
      await tx.insert(stepReleases).values(
        schedule.map((entry) => ({
          organisationId: session.organisationId,
          cohortId,
          stepId: entry.stepId,
          opensAfterDays: entry.opensAfterDays ?? null,
          dueAfterDays: entry.dueAfterDays ?? null,
          closesAfterDays: entry.closesAfterDays ?? null,
        })),
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.schedule_set",
      entityType: "cohort",
      entityId: cohortId,
      after: { steps: schedule.length },
    });

    return schedule.length;
  });
}

export async function listCohorts(session: AuthenticatedSession) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: cohorts.id,
        name: cohorts.name,
        code: cohorts.code,
        startDate: cohorts.startDate,
        endDate: cohorts.endDate,
        status: cohorts.status,
        courseId: cohorts.courseId,
        courseTitle: courses.title,
      })
      .from(cohorts)
      .innerJoin(courses, eq(courses.id, cohorts.courseId))
      .orderBy(asc(cohorts.startDate)),
  );
}

export async function getCohort(session: AuthenticatedSession, cohortId: string) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx
      .select()
      .from(cohorts)
      .where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortError("No such cohort.", "not_found");

    const members = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        joinedAt: cohortMembers.joinedAt,
        leftAt: cohortMembers.leftAt,
      })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(eq(cohortMembers.cohortId, cohortId))
      .orderBy(asc(users.lastName));

    const releases = await tx
      .select()
      .from(stepReleases)
      .where(eq(stepReleases.cohortId, cohortId));

    const steps = await tx
      .select()
      .from(courseSteps)
      .where(eq(courseSteps.courseId, cohort.courseId))
      .orderBy(asc(courseSteps.sortOrder));

    return {
      cohort,
      members,
      steps: steps.map((step) => {
        const release = releases.find((row) => row.stepId === step.id);
        return {
          id: step.id,
          title: step.title,
          kind: step.kind,
          sortOrder: step.sortOrder,
          opensAfterDays: release?.opensAfterDays ?? null,
          dueAfterDays: release?.dueAfterDays ?? null,
          /**
           * A grace period counted from the due date, not from the start.
           *
           * Returned because setSchedule replaces a cohort's whole schedule
           * rather than merging into it: an editor that cannot read this back
           * would post the schedule without it and silently drop every
           * closing time, which nobody would notice until a step that should
           * have closed did not.
           */
          closesAfterDays: release?.closesAfterDays ?? null,
          opensAt:
            release?.opensAfterDays != null
              ? dayFrom(cohort.startDate, release.opensAfterDays)
              : null,
          dueAt:
            release?.dueAfterDays != null
              ? dayFrom(cohort.startDate, release.dueAfterDays)
              : null,
          closesAt:
            release?.dueAfterDays != null && release?.closesAfterDays != null
              ? dayFrom(
                  cohort.startDate,
                  release.dueAfterDays + release.closesAfterDays,
                )
              : null,
        };
      }),
    };
  });
}

/** Everyone on this cohort who is enrolled and has not left. */
export async function activeMemberIds(
  tx: TenantDatabase,
  cohortId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ userId: cohortMembers.userId })
    .from(cohortMembers)
    .where(
      and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)),
    );
  return rows.map((row) => row.userId);
}

/** The enrolment a cohort member holds on its course, where they have one. */
export async function enrolmentFor(
  tx: TenantDatabase,
  courseId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const rows = await tx
    .select({ id: enrolments.id, userId: enrolments.userId })
    .from(enrolments)
    .where(
      and(eq(enrolments.courseId, courseId), inArray(enrolments.userId, userIds)),
    );

  return new Map(rows.map((row) => [row.userId, row.id]));
}
