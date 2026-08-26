import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentCriteria,
  assessmentItemCriteria,
  assessmentItems,
  assessmentPapers,
  assessmentSections,
  assessmentSubmissions,
  assessments,
  cohortMembers,
  courseSteps,
  curriculumModules,
  enrolments,
  itemResponses,
  lessonCriteria,
  lessons,
  progressRecords,
  stepProgress,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The three reports a provider acts on.
 *
 * Deliberately not a dashboard. Each of these exists because it surfaces
 * something that is otherwise invisible until it is expensive:
 *
 *   - a criterion nothing tests, which no learner can ever be found competent
 *     against, and which therefore holds up everybody on the qualification;
 *   - a question nobody can answer, or everybody can, which is a defect in the
 *     paper rather than in the cohort;
 *   - a step where a cohort stalls, which is where the programme actually
 *     needs attention rather than where the plan says it should.
 */

/** A criterion, and what stands behind it. */
export type CriterionCoverageRow = {
  criterionId: string;
  code: string;
  description: string;
  moduleCode: string;
  moduleTitle: string;
  component: string;
  /** Lessons that teach it. */
  taughtBy: number;
  /** Questions on a summative paper that test it. */
  testedBySummative: number;
  /** Questions on a workbook. Developmental, so they cannot evidence it. */
  testedByFormative: number;
  /**
   * Nothing summative tests it, so nobody can ever be found competent against
   * it. This is the finding: it holds up every learner on the qualification
   * and nothing else in the platform says so out loud.
   */
  nothingTests: boolean;
  nothingTeaches: boolean;
  /**
   * Tested only in a workbook. The most misleading state of the three: it
   * looks assessed on any list of questions, and evidences nothing.
   */
  onlyFormative: boolean;
};

/**
 * What nothing tests.
 *
 * The publish gate already refuses a course whose lessons leave a criterion
 * untaught. Nothing until now checked the other half — that something actually
 * *assesses* it — and the two fail differently. An untaught criterion produces
 * a learner who cannot answer. An untested one produces a learner who can
 * never be found competent no matter what they do, and the gap shows up as an
 * EISA readiness figure that will not reach 100% for reasons nobody can see.
 */
export async function criterionCoverage(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<CriterionCoverageRow[]> {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const criteria = await tx
      .select({
        criterionId: assessmentCriteria.id,
        code: assessmentCriteria.code,
        description: assessmentCriteria.description,
        moduleCode: curriculumModules.code,
        moduleTitle: curriculumModules.title,
        component: curriculumModules.component,
      })
      .from(assessmentCriteria)
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, assessmentCriteria.curriculumModuleId),
      )
      .where(eq(curriculumModules.qualificationId, qualificationId))
      .orderBy(asc(curriculumModules.code), asc(assessmentCriteria.code));

    if (criteria.length === 0) return [];

    const ids = criteria.map((row) => row.criterionId);

    const taught = await tx
      .select({ criterionId: lessonCriteria.criterionId })
      .from(lessonCriteria)
      .where(inArray(lessonCriteria.criterionId, ids));

    // Both tagging routes, because the join table replaced a single column on
    // the item and the old one is still read everywhere else. Counting only
    // the new one would report questions authored earlier as testing nothing,
    // which is a false alarm in the one report meant to find real gaps.
    const tagged = await tx
      .select({
        criterionId: assessmentItemCriteria.criterionId,
        purpose: assessments.purpose,
      })
      .from(assessmentItemCriteria)
      .innerJoin(
        assessmentItems,
        eq(assessmentItems.id, assessmentItemCriteria.itemId),
      )
      .innerJoin(
        assessmentSections,
        eq(assessmentSections.id, assessmentItems.sectionId),
      )
      .innerJoin(
        assessmentPapers,
        eq(assessmentPapers.id, assessmentSections.paperId),
      )
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentPapers.assessmentId),
      )
      .where(inArray(assessmentItemCriteria.criterionId, ids));

    const legacy = await tx
      .select({
        criterionId: assessmentItems.criterionId,
        purpose: assessments.purpose,
      })
      .from(assessmentItems)
      .innerJoin(
        assessmentSections,
        eq(assessmentSections.id, assessmentItems.sectionId),
      )
      .innerJoin(
        assessmentPapers,
        eq(assessmentPapers.id, assessmentSections.paperId),
      )
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentPapers.assessmentId),
      )
      .where(
        and(
          isNotNull(assessmentItems.criterionId),
          inArray(assessmentItems.criterionId, ids),
        ),
      );

    const taughtCount = new Map<string, number>();
    for (const row of taught) {
      taughtCount.set(
        row.criterionId,
        (taughtCount.get(row.criterionId) ?? 0) + 1,
      );
    }

    const summative = new Map<string, number>();
    const formative = new Map<string, number>();

    for (const row of [...tagged, ...legacy]) {
      if (!row.criterionId) continue;
      const target = row.purpose === "summative" ? summative : formative;
      target.set(row.criterionId, (target.get(row.criterionId) ?? 0) + 1);
    }

    return criteria.map((row) => {
      const testedBySummative = summative.get(row.criterionId) ?? 0;
      const testedByFormative = formative.get(row.criterionId) ?? 0;
      const taughtBy = taughtCount.get(row.criterionId) ?? 0;

      return {
        ...row,
        taughtBy,
        testedBySummative,
        testedByFormative,
        nothingTests: testedBySummative === 0,
        nothingTeaches: taughtBy === 0,
        onlyFormative: testedBySummative === 0 && testedByFormative > 0,
      };
    });
  });
}

export type QuestionPerformanceRow = {
  itemId: string;
  stem: string;
  assessmentTitle: string;
  paperCode: string;
  sectionTitle: string;
  points: number | null;
  /** How many learners this question has been marked for, on a first attempt. */
  firstAttempts: number;
  /** Mean marks awarded as a percentage of the marks available. */
  meanPercent: number | null;
  fullMarks: number;
  zeroMarks: number;
  /**
   * Almost nobody gets it. Either the question is badly written or what it
   * tests was never taught — and both are the provider's to fix, not the
   * cohort's.
   */
  nobodyGetsIt: boolean;
  /** Everybody gets it, so it distinguishes nothing and tests nothing. */
  everybodyGetsIt: boolean;
};

/**
 * How each question actually performed, on first attempts only.
 *
 * First attempts only because a re-sit is a different measurement: the learner
 * has seen the paper, been taught again, and is being asked a question they
 * already know was a problem. Mixing the two makes a bad question look
 * acceptable.
 *
 * Below the threshold the flags stay off. A question two people have answered
 * tells you about those two people.
 */
export const MINIMUM_ATTEMPTS_TO_JUDGE = 5;

export async function questionPerformance(
  session: AuthenticatedSession,
  assessmentId: string,
): Promise<QuestionPerformanceRow[]> {
  assertSessionCan(session, "report:tenant");

  return withTenant(session.organisationId, async (tx) => {
    const items = await tx
      .select({
        itemId: assessmentItems.id,
        stem: assessmentItems.stem,
        points: assessmentItems.points,
        sectionTitle: assessmentSections.title,
        paperCode: assessmentPapers.code,
        assessmentTitle: assessments.title,
        sortOrder: assessmentItems.sortOrder,
      })
      .from(assessmentItems)
      .innerJoin(
        assessmentSections,
        eq(assessmentSections.id, assessmentItems.sectionId),
      )
      .innerJoin(
        assessmentPapers,
        eq(assessmentPapers.id, assessmentSections.paperId),
      )
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentPapers.assessmentId),
      )
      .where(eq(assessmentPapers.assessmentId, assessmentId))
      .orderBy(
        asc(assessmentPapers.code),
        asc(assessmentSections.sortOrder),
        asc(assessmentItems.sortOrder),
      );

    if (items.length === 0) return [];

    const responses = await tx
      .select({
        itemId: itemResponses.itemId,
        awardedMarks: itemResponses.awardedMarks,
      })
      .from(itemResponses)
      .innerJoin(
        assessmentSubmissions,
        eq(assessmentSubmissions.id, itemResponses.submissionId),
      )
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, assessmentId),
          eq(assessmentSubmissions.attemptNumber, 1),
          isNotNull(itemResponses.awardedMarks),
          inArray(
            itemResponses.itemId,
            items.map((item) => item.itemId),
          ),
        ),
      );

    const byItem = new Map<string, number[]>();
    for (const row of responses) {
      const marks = Number(row.awardedMarks);
      if (!Number.isFinite(marks)) continue;
      byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), marks]);
    }

    return items.map((item) => {
      const marks = byItem.get(item.itemId) ?? [];
      const available = item.points ?? 0;

      const meanPercent =
        marks.length > 0 && available > 0
          ? Math.round(
              (marks.reduce((total, mark) => total + mark, 0) /
                marks.length /
                available) *
                100,
            )
          : null;

      const judgeable = marks.length >= MINIMUM_ATTEMPTS_TO_JUDGE;

      return {
        itemId: item.itemId,
        stem: item.stem,
        assessmentTitle: item.assessmentTitle,
        paperCode: item.paperCode,
        sectionTitle: item.sectionTitle,
        points: item.points,
        firstAttempts: marks.length,
        meanPercent,
        fullMarks: marks.filter((mark) => available > 0 && mark >= available)
          .length,
        zeroMarks: marks.filter((mark) => mark === 0).length,
        nobodyGetsIt:
          judgeable && meanPercent !== null && meanPercent < 30,
        everybodyGetsIt:
          judgeable && meanPercent !== null && meanPercent > 95,
      };
    });
  });
}

export type StepTimingRow = {
  stepId: string;
  title: string;
  kind: string;
  sortOrder: number;
  /** Learners on the cohort who have opened it. */
  opened: number;
  /** Learners who have finished it. */
  completed: number;
  /** Opened it and have not finished. */
  inProgress: number;
  /** Median days from opening to finishing, across those who finished. */
  medianDays: number | null;
  longestDays: number | null;
};

/**
 * How long each step is actually taking a cohort.
 *
 * The median rather than the mean, because one learner who opened a step in
 * March and finished it in September moves a mean enough to hide where
 * everybody else is. The longest is reported beside it so that learner is
 * still visible rather than smoothed away.
 *
 * What this is for: a step where most of a cohort is sitting is where the
 * programme needs attention, and it is rarely the step the plan predicted.
 */
export async function stepTimings(
  session: AuthenticatedSession,
  cohortId: string,
  courseId: string,
): Promise<StepTimingRow[]> {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const members = await tx
      .select({ userId: cohortMembers.userId })
      .from(cohortMembers)
      .where(eq(cohortMembers.cohortId, cohortId));

    const memberIds = members.map((row) => row.userId);

    const steps = await tx
      .select()
      .from(courseSteps)
      .where(eq(courseSteps.courseId, courseId))
      .orderBy(asc(courseSteps.sortOrder));

    if (steps.length === 0 || memberIds.length === 0) {
      return steps.map((step) => ({
        stepId: step.id,
        title: step.title ?? step.kind,
        kind: step.kind,
        sortOrder: step.sortOrder,
        opened: 0,
        completed: 0,
        inProgress: 0,
        medianDays: null,
        longestDays: null,
      }));
    }

    const opens = await tx
      .select({
        stepId: stepProgress.stepId,
        userId: stepProgress.userId,
        openedAt: stepProgress.openedAt,
      })
      .from(stepProgress)
      .where(
        and(
          inArray(
            stepProgress.stepId,
            steps.map((step) => step.id),
          ),
          inArray(stepProgress.userId, memberIds),
        ),
      );

    // Two different completion signals, because a step is finished in two
    // different ways: a lesson is marked complete, an assessment is handed in.
    const lessonDone = await tx
      .select({
        lessonId: progressRecords.lessonId,
        userId: enrolments.userId,
        completedAt: progressRecords.completedAt,
      })
      .from(progressRecords)
      .innerJoin(enrolments, eq(enrolments.id, progressRecords.enrolmentId))
      .innerJoin(lessons, eq(lessons.id, progressRecords.lessonId))
      .where(
        and(
          inArray(enrolments.userId, memberIds),
          eq(progressRecords.state, "completed"),
          isNotNull(progressRecords.completedAt),
        ),
      );

    const submitted = await tx
      .select({
        assessmentId: assessmentSubmissions.assessmentId,
        userId: assessmentSubmissions.userId,
        submittedAt: assessmentSubmissions.submittedAt,
        attemptNumber: assessmentSubmissions.attemptNumber,
      })
      .from(assessmentSubmissions)
      .where(
        and(
          inArray(assessmentSubmissions.userId, memberIds),
          isNotNull(assessmentSubmissions.submittedAt),
          eq(assessmentSubmissions.attemptNumber, 1),
        ),
      );

    const lessonAt = new Map<string, Date>();
    for (const row of lessonDone) {
      if (row.completedAt) {
        lessonAt.set(`${row.lessonId}:${row.userId}`, row.completedAt);
      }
    }

    const submittedAt = new Map<string, Date>();
    for (const row of submitted) {
      if (row.submittedAt) {
        submittedAt.set(`${row.assessmentId}:${row.userId}`, row.submittedAt);
      }
    }

    return steps.map((step) => {
      const openedRows = opens.filter((row) => row.stepId === step.id);
      const durations: number[] = [];
      let completed = 0;

      for (const open of openedRows) {
        const finishedAt =
          step.kind === "lesson" && step.lessonId
            ? lessonAt.get(`${step.lessonId}:${open.userId}`)
            : step.assessmentId
              ? submittedAt.get(`${step.assessmentId}:${open.userId}`)
              : // A document is read, not handed in: opening it is all there
                // is to do, so it completes the moment it opens.
                step.kind === "document"
                ? open.openedAt
                : undefined;

        if (!finishedAt) continue;
        completed += 1;

        const days =
          (finishedAt.getTime() - open.openedAt.getTime()) / 86_400_000;
        durations.push(Math.max(0, days));
      }

      durations.sort((a, b) => a - b);
      const middle = Math.floor(durations.length / 2);

      return {
        stepId: step.id,
        title: step.title ?? step.kind,
        kind: step.kind,
        sortOrder: step.sortOrder,
        opened: openedRows.length,
        completed,
        inProgress: openedRows.length - completed,
        medianDays:
          durations.length === 0
            ? null
            : Math.round(
                (durations.length % 2 === 1
                  ? durations[middle]
                  : (durations[middle - 1] + durations[middle]) / 2) * 10,
              ) / 10,
        longestDays:
          durations.length === 0
            ? null
            : Math.round(durations[durations.length - 1] * 10) / 10,
      };
    });
  });
}

/** Summative assessments worth running the question report against. */
export async function reportableAssessments(session: AuthenticatedSession) {
  assertSessionCan(session, "report:tenant");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: assessments.id,
        title: assessments.title,
        purpose: assessments.purpose,
      })
      .from(assessments)
      .where(eq(assessments.status, "published"))
      .orderBy(asc(assessments.title)),
  );
}
