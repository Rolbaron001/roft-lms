import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  cohortMembers,
  cohorts,
  courseSteps,
  courses,
  enrolments,
  qualifications,
  stepReleases,
  studyUnits,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { enrolUser } from "./enrolment";
import { cohortCourseIds, dayFrom } from "./schedule";
import { resolveTitles } from "./spine";

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
    /** One course or study unit; or name a qualification instead. */
    courseId?: string;
    /** A whole qualification, every study unit on one schedule. */
    qualificationId?: string;
    /** "scheduled" (the default) or "open": everything at once. */
    releaseMode?: "scheduled" | "open";
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
  if (Boolean(input.courseId) === Boolean(input.qualificationId)) {
    throw new CohortError("Choose either a course or a whole qualification for the cohort.", "invalid");
  }

  return withTenant(session.organisationId, async (tx) => {
    if (input.courseId) {
      const [course] = await tx.select({ id: courses.id }).from(courses).where(eq(courses.id, input.courseId));
      if (!course) throw new CohortError("No such course.", "not_found");
    } else {
      const [qualification] = await tx.select({ id: qualifications.id }).from(qualifications).where(eq(qualifications.id, input.qualificationId!));
      if (!qualification) throw new CohortError("No such qualification.", "not_found");
    }

    const [cohort] = await tx
      .insert(cohorts)
      .values({
        organisationId: session.organisationId,
        courseId: input.courseId ?? null,
        qualificationId: input.qualificationId ?? null,
        releaseMode: input.releaseMode === "open" ? "open" : "scheduled",
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
      `That cohort is ${cohort.status}, so no one else can join it.`,
      "invalid",
    );
  }

  // Somebody re-joining after a break is already enrolled, and enrolling them
  // twice is refused. The cohort is the register; the enrolment is what lets
  // them open anything. Only the missing half is created. A cohort that walks
  // a whole qualification enrols on every study unit that is live; one made
  // live later is added for its members then (enrolCohortsOnCourse).
  await enrolOnCohortCourses(session, cohort, userId);

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

async function enrolOnCohortCourses(
  session: AuthenticatedSession,
  cohort: { courseId: string | null; qualificationId: string | null },
  userId: string,
) {
  const { courseIds, published, enrolled } = await withTenant(session.organisationId, async (tx) => {
    const ids = await cohortCourseIds(tx, cohort);
    const live = ids.length ? await tx.select({ id: courses.id }).from(courses).where(and(inArray(courses.id, ids), eq(courses.status, "published"))) : [];
    const mine = ids.length ? await tx.select({ courseId: enrolments.courseId }).from(enrolments).where(and(inArray(enrolments.courseId, ids), eq(enrolments.userId, userId))) : [];
    return { courseIds: ids, published: new Set(live.map((row) => row.id)), enrolled: new Set(mine.map((row) => row.courseId)) };
  });
  for (const courseId of courseIds) {
    if (enrolled.has(courseId)) continue;
    // A single course must be live to join; a qualification's units are
    // joined as they go live.
    if (cohort.qualificationId && !published.has(courseId)) continue;
    await enrolUser(session, { userId, courseId, qualificationId: cohort.qualificationId ?? undefined });
  }
}

/**
 * Enrols the members of every qualification cohort on a study unit that has
 * just gone live, so a cohort formed before the qualification was finished
 * gains each unit as it is made live.
 */
export async function enrolCohortsOnCourse(session: AuthenticatedSession, courseId: string) {
  const memberships = await withTenant(session.organisationId, async (tx) => {
    const [unit] = await tx
      .select({ qualificationId: studyUnits.qualificationId })
      .from(courses)
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(eq(courses.id, courseId));
    if (!unit) return [];
    return tx
      .select({ userId: cohortMembers.userId, courseId: cohorts.courseId, qualificationId: cohorts.qualificationId })
      .from(cohortMembers)
      .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
      .where(and(eq(cohorts.qualificationId, unit.qualificationId), isNull(cohortMembers.leftAt)));
  });
  for (const member of memberships) await enrolOnCohortCourses(session, member, member.userId);
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
      .where(inArray(courseSteps.courseId, await cohortCourseIdsOrNone(tx, cohort)));
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

    // A facilitator's hand release survives a new schedule: it was a decision
    // about these learners, not part of the dates being replaced.
    const handReleased = await tx
      .select({ stepId: stepReleases.stepId, releasedAt: stepReleases.releasedAt, releasedById: stepReleases.releasedById })
      .from(stepReleases)
      .where(and(eq(stepReleases.cohortId, cohortId), isNotNull(stepReleases.releasedAt)));
    const releasedByStep = new Map(handReleased.map((row) => [row.stepId, row]));

    await tx.delete(stepReleases).where(eq(stepReleases.cohortId, cohortId));

    const rows = schedule.map((entry) => ({
      organisationId: session.organisationId,
      cohortId,
      stepId: entry.stepId,
      opensAfterDays: entry.opensAfterDays ?? null,
      dueAfterDays: entry.dueAfterDays ?? null,
      closesAfterDays: entry.closesAfterDays ?? null,
      releasedAt: releasedByStep.get(entry.stepId)?.releasedAt ?? null,
      releasedById: releasedByStep.get(entry.stepId)?.releasedById ?? null,
    }));
    for (const row of handReleased) {
      if (!schedule.some((entry) => entry.stepId === row.stepId) && known.has(row.stepId)) {
        rows.push({
          organisationId: session.organisationId,
          cohortId,
          stepId: row.stepId,
          opensAfterDays: null,
          dueAfterDays: null,
          closesAfterDays: null,
          releasedAt: row.releasedAt,
          releasedById: row.releasedById,
        });
      }
    }
    if (rows.length > 0) await tx.insert(stepReleases).values(rows);

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

/**
 * Releases one step to a cohort now, or takes the hand release back.
 *
 * Heidi, 5 October 2026: material reaches a cohort on the schedule's date or
 * "until the facilitator clicks a button and says okay, release this". The
 * release overrides any later date; taking it back returns the step to its
 * date, or to waiting where it has none.
 */
export async function setStepReleased(
  session: AuthenticatedSession,
  cohortId: string,
  stepId: string,
  released: boolean,
) {
  assertSessionCan(session, "enrolment:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortError("No such cohort.", "not_found");
    const [step] = await tx
      .select({ id: courseSteps.id })
      .from(courseSteps)
      .where(and(eq(courseSteps.id, stepId), inArray(courseSteps.courseId, await cohortCourseIdsOrNone(tx, cohort))));
    if (!step) throw new CohortError("That step is not on this cohort's course.", "invalid");

    const releasedAt = released ? new Date() : null;
    const releasedById = released ? session.userId : null;
    const [existing] = await tx
      .select({ id: stepReleases.id, opensAfterDays: stepReleases.opensAfterDays, dueAfterDays: stepReleases.dueAfterDays })
      .from(stepReleases)
      .where(and(eq(stepReleases.cohortId, cohortId), eq(stepReleases.stepId, stepId)));

    if (existing) {
      // A row kept only to hold the hand release goes with it: otherwise its
      // empty dates would read as "opens at once".
      if (!released && existing.opensAfterDays === null && existing.dueAfterDays === null) {
        await tx.delete(stepReleases).where(eq(stepReleases.id, existing.id));
      } else {
        await tx.update(stepReleases).set({ releasedAt, releasedById }).where(eq(stepReleases.id, existing.id));
      }
    } else if (released) {
      await tx.insert(stepReleases).values({ organisationId: session.organisationId, cohortId, stepId, releasedAt, releasedById });
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: released ? "cohort.step_released" : "cohort.step_release_withdrawn",
      entityType: "cohort",
      entityId: cohortId,
      after: { stepId },
    });
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
        qualificationId: cohorts.qualificationId,
        releaseMode: cohorts.releaseMode,
        // What the cohort walks: its course, or the whole qualification.
        courseTitle: sql<string>`coalesce(${courses.title}, ${qualifications.title})`,
      })
      .from(cohorts)
      .leftJoin(courses, eq(courses.id, cohorts.courseId))
      .leftJoin(qualifications, eq(qualifications.id, cohorts.qualificationId))
      .orderBy(asc(cohorts.startDate)),
  );
}

/** Qualifications a cohort can walk end to end: those with study units. */
export async function qualificationsForCohorts(session: AuthenticatedSession) {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, (tx) =>
    tx
      .selectDistinct({ id: qualifications.id, title: qualifications.title, credits: qualifications.totalCredits })
      .from(qualifications)
      .innerJoin(studyUnits, eq(studyUnits.qualificationId, qualifications.id))
      .orderBy(asc(qualifications.title)),
  );
}

/** The steps a cohort's schedule covers: one course's, or every study unit's of its qualification. */
async function cohortCourseIdsOrNone(tx: TenantDatabase, cohort: { courseId: string | null; qualificationId: string | null }) {
  const ids = await cohortCourseIds(tx, cohort);
  // inArray with nothing matches nothing, which is the right answer.
  return ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
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

    // Every course the cohort walks, in study unit order, each one's steps in
    // its own order.
    const courseIds = await cohortCourseIds(tx, cohort);
    const unitCodes = new Map(
      (courseIds.length
        ? await tx
            .select({ courseId: courses.id, code: studyUnits.code })
            .from(courses)
            .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
            .where(inArray(courses.id, courseIds))
        : []
      ).map((row) => [row.courseId, row.code]),
    );
    const unordered = courseIds.length ? await tx.select().from(courseSteps).where(inArray(courseSteps.courseId, courseIds)) : [];
    const steps = unordered.sort((a, b) => courseIds.indexOf(a.courseId) - courseIds.indexOf(b.courseId) || a.sortOrder - b.sortOrder);
    // A step the platform built has no title of its own; it carries the name
    // of what it points at, never a bare "document" (Heidi, 5 October 2026).
    const titles = await resolveTitles(tx, steps);
    const [qualification] = cohort.qualificationId
      ? await tx.select({ title: qualifications.title }).from(qualifications).where(eq(qualifications.id, cohort.qualificationId))
      : [];

    return {
      cohort,
      courseIds,
      qualificationTitle: qualification?.title ?? null,
      members,
      steps: steps.map((step) => {
        const release = releases.find((row) => row.stepId === step.id);
        const title = titles.get(step.id) ?? step.title;
        return {
          id: step.id,
          courseId: step.courseId,
          // A qualification cohort's steps say which study unit they are in.
          title: cohort.qualificationId && unitCodes.get(step.courseId) ? `${unitCodes.get(step.courseId)} · ${title}` : title,
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
          releasedAt: release?.releasedAt ?? null,
          /** Whether a learner on this cohort can reach it today. */
          released:
            cohort.releaseMode === "open" ||
            Boolean(release?.releasedAt) ||
            (release !== undefined &&
              (release.opensAfterDays === null || dayFrom(cohort.startDate, release.opensAfterDays) <= new Date())),
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
