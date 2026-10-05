import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { cohortMembers, cohorts, courses, enrolments, exitLevelOutcomes, qualifications, studyUnits } from "@/db/schema";
import { can } from "./rbac";
import type { AuthenticatedSession } from "./session";
import { stepsForLearner } from "./spine";

/**
 * A learner's qualifications, each with every study unit they must complete.
 *
 * Roland, 5 October 2026: "if he is enrolled for a qualification he should be
 * able to see an introduction to the qualification, followed by a list of
 * Study Units that he must complete." A learner is enrolled on a study unit's
 * course; the qualification is the one that unit belongs to, so this is read
 * from the enrolments rather than asked of anyone.
 */

export type LearnerUnit = {
  id: string;
  code: string;
  title: string;
  outcome: string | null;
  enrolmentId: string | null;
  done: number;
  total: number;
  state: "completed" | "in_progress" | "open" | "waiting_cohort" | "waiting_release" | "not_enrolled";
  /** When it is waiting, what for, in the spine's own words. */
  waiting: string | null;
};

export type LearnerQualification = {
  id: string;
  title: string;
  description: string | null;
  saqaId: string | null;
  nqfLevel: number | null;
  totalCredits: number | null;
  cohortName: string | null;
  cohortStart: string | null;
  units: LearnerUnit[];
  enrolmentIds: string[];
};

export async function learnerQualifications(session: AuthenticatedSession, userId: string = session.userId): Promise<LearnerQualification[]> {
  if (userId !== session.userId && !can(session, "enrolment:read_all")) return [];

  const data = await withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        enrolmentId: enrolments.id,
        courseId: enrolments.courseId,
        completedAt: enrolments.completedAt,
        studyUnitId: courses.studyUnitId,
        qualificationId: studyUnits.qualificationId,
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(eq(enrolments.userId, userId));
    if (rows.length === 0) return null;

    const qualificationIds = [...new Set(rows.map((row) => row.qualificationId))];
    const quals = await tx
      .select({ id: qualifications.id, title: qualifications.title, description: qualifications.description, saqaId: qualifications.saqaId, nqfLevel: qualifications.nqfLevel, totalCredits: qualifications.totalCredits })
      .from(qualifications)
      .where(inArray(qualifications.id, qualificationIds));
    const units = await tx
      .select({ id: studyUnits.id, code: studyUnits.code, title: studyUnits.title, qualificationId: studyUnits.qualificationId, outcome: exitLevelOutcomes.description })
      .from(studyUnits)
      .leftJoin(exitLevelOutcomes, eq(exitLevelOutcomes.id, studyUnits.exitLevelOutcomeId))
      .where(inArray(studyUnits.qualificationId, qualificationIds))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));
    const memberships = await tx
      .select({ name: cohorts.name, startDate: cohorts.startDate, courseId: cohorts.courseId })
      .from(cohortMembers)
      .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
      .where(and(eq(cohortMembers.userId, userId), isNull(cohortMembers.leftAt)));
    return { rows, quals, units, memberships };
  });
  if (!data) return [];

  const result: LearnerQualification[] = [];
  for (const qualification of data.quals) {
    const mine = data.rows.filter((row) => row.qualificationId === qualification.id);
    const courseIds = new Set(mine.map((row) => row.courseId));
    const cohort = data.memberships.find((one) => courseIds.has(one.courseId)) ?? null;
    const units: LearnerUnit[] = [];
    for (const unit of data.units.filter((one) => one.qualificationId === qualification.id)) {
      const enrolment = mine.find((row) => row.studyUnitId === unit.id);
      if (!enrolment) {
        units.push({ id: unit.id, code: unit.code, title: unit.title, outcome: unit.outcome, enrolmentId: null, done: 0, total: 0, state: "not_enrolled", waiting: null });
        continue;
      }
      const steps = await stepsForLearner(session, enrolment.courseId!, userId);
      const done = steps.filter((step) => step.state === "done").length;
      const anyOpen = steps.some((step) => step.open);
      const firstBlocked = steps.find((step) => !step.open)?.blockedBy[0] ?? null;
      const state: LearnerUnit["state"] =
        enrolment.completedAt || (steps.length > 0 && done === steps.length)
          ? "completed"
          : done > 0 || steps.some((step) => step.state === "in_progress")
            ? "in_progress"
            : anyOpen || steps.length === 0
              ? "open"
              : firstBlocked && /placed in a cohort/.test(firstBlocked)
                ? "waiting_cohort"
                : "waiting_release";
      units.push({
        id: unit.id,
        code: unit.code,
        title: unit.title,
        outcome: unit.outcome,
        enrolmentId: enrolment.enrolmentId,
        done,
        total: steps.length,
        state,
        waiting: state === "waiting_cohort" || state === "waiting_release" ? firstBlocked : null,
      });
    }
    result.push({
      ...qualification,
      cohortName: cohort?.name ?? null,
      cohortStart: cohort?.startDate ?? null,
      units,
      enrolmentIds: mine.map((row) => row.enrolmentId),
    });
  }
  return result;
}
