import { and, asc, eq, isNull, or } from "drizzle-orm";
import type { TenantDatabase } from "@/db/client";
import { cohortMembers, cohorts, courses, stepReleases, studyUnits } from "@/db/schema";

/**
 * Reading a cohort's schedule.
 *
 * Deliberately its own module rather than part of `cohorts`, which reaches
 * into enrolment to put a learner on a course. The spine needs the dates and
 * nothing else, and importing the rest would make a cycle: spine to cohorts to
 * enrolment and back to spine. Cycles like that resolve at runtime by accident
 * of ordering, which is a poor thing to rely on.
 */

/** Midnight at the start of the day, `days` after the cohort began. */
export function dayFrom(startDate: string, days: number): Date {
  const [year, month, day] = startDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days));
}

export type ScheduledStep = {
  stepId: string;
  opensAt: Date | null;
  dueAt: Date | null;
  closesAt: Date | null;
  /** Released by a facilitator's hand, whatever the date says. */
  releasedAt: Date | null;
};

/**
 * The courses a cohort walks: its one course, or every study unit's course of
 * the qualification it walks (Roland, 5 October 2026: both kinds exist).
 */
export async function cohortCourseIds(
  tx: TenantDatabase,
  cohort: { courseId: string | null; qualificationId: string | null },
): Promise<string[]> {
  if (cohort.courseId) return [cohort.courseId];
  if (!cohort.qualificationId) return [];
  const rows = await tx
    .select({ id: courses.id })
    .from(courses)
    .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
    .where(eq(studyUnits.qualificationId, cohort.qualificationId))
    .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));
  return rows.map((row) => row.id);
}

/** The qualification a study unit's course belongs to, if it is one. */
async function qualificationOfCourse(tx: TenantDatabase, courseId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: studyUnits.qualificationId })
    .from(courses)
    .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
    .where(eq(courses.id, courseId));
  return row?.id ?? null;
}

/**
 * Whether anybody walks this course in a cohort. A study unit whose course
 * has cohorts releases its material through them; one with none (a provider
 * who runs no cohorts) is not held back by a rule it does not use.
 */
export async function courseUsesCohorts(tx: TenantDatabase, courseId: string): Promise<boolean> {
  const qualificationId = await qualificationOfCourse(tx, courseId);
  const [one] = await tx
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(qualificationId ? or(eq(cohorts.courseId, courseId), eq(cohorts.qualificationId, qualificationId)) : eq(cohorts.courseId, courseId))
    .limit(1);
  return Boolean(one);
}

/**
 * The cohort a learner walks a course with, and the dates that follow from it.
 *
 * Returns nothing where the learner is on no cohort, which is the ordinary
 * case for a course somebody is simply assigned. The spine then falls back to
 * whatever the course itself says.
 */
export async function scheduleForLearner(
  tx: TenantDatabase,
  courseId: string,
  userId: string,
): Promise<{ cohortId: string; steps: Map<string, ScheduledStep>; openAll: boolean } | null> {
  // The learner's cohort for this course: one that walks the course itself,
  // or one that walks the whole qualification the course is a study unit of.
  const qualificationId = await qualificationOfCourse(tx, courseId);
  const [membership] = await tx
    .select({ cohortId: cohortMembers.cohortId, startDate: cohorts.startDate, releaseMode: cohorts.releaseMode })
    .from(cohortMembers)
    .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
    .where(
      and(
        eq(cohortMembers.userId, userId),
        qualificationId ? or(eq(cohorts.courseId, courseId), eq(cohorts.qualificationId, qualificationId)) : eq(cohorts.courseId, courseId),
        isNull(cohortMembers.leftAt),
      ),
    )
    .limit(1);

  if (!membership) return null;

  const releases = await tx
    .select()
    .from(stepReleases)
    .where(eq(stepReleases.cohortId, membership.cohortId));

  const steps = new Map<string, ScheduledStep>();
  for (const release of releases) {
    const opensAt =
      release.opensAfterDays != null
        ? dayFrom(membership.startDate, release.opensAfterDays)
        : null;
    const dueAt =
      release.dueAfterDays != null
        ? dayFrom(membership.startDate, release.dueAfterDays)
        : null;
    const closesAt =
      release.dueAfterDays != null && release.closesAfterDays != null
        ? dayFrom(
            membership.startDate,
            release.dueAfterDays + release.closesAfterDays,
          )
        : null;

    steps.set(release.stepId, { stepId: release.stepId, opensAt, dueAt, closesAt, releasedAt: release.releasedAt });
  }

  // A cohort of independent learners has everything at once.
  return { cohortId: membership.cohortId, steps, openAll: membership.releaseMode === "open" };
}

