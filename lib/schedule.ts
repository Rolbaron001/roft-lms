import { and, eq, isNull } from "drizzle-orm";
import type { TenantDatabase } from "@/db/client";
import { cohortMembers, cohorts, stepReleases } from "@/db/schema";

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
};

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
): Promise<{ cohortId: string; steps: Map<string, ScheduledStep> } | null> {
  const [membership] = await tx
    .select({ cohortId: cohortMembers.cohortId, startDate: cohorts.startDate })
    .from(cohortMembers)
    .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
    .where(
      and(
        eq(cohortMembers.userId, userId),
        eq(cohorts.courseId, courseId),
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

    steps.set(release.stepId, { stepId: release.stepId, opensAt, dueAt, closesAt });
  }

  return { cohortId: membership.cohortId, steps };
}

