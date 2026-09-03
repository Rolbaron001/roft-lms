/**
 * The three reports, against a live database.
 *
 * Each of these exists to surface something that is otherwise invisible until
 * it is expensive, so the tests are written around the finding rather than
 * around the shape of the output: a criterion nothing tests, a question nobody
 * can answer, a step a cohort is sitting on.
 *
 * The one that matters most is the criterion tested only in a workbook. It
 * looks assessed on every list of questions in the platform and evidences
 * nothing, because a workbook is developmental — so a report that counted
 * questions without looking at their purpose would confirm a gap was closed
 * when it was not.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  assessmentCriteria,
  competencies,
  competencyFrameworks,
  curriculumModules,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  addLesson,
  addSection as addCourseSection,
  createCourse,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import { createAssessment, publishAssessment } from "@/lib/assessment";
import {
  addPaper,
  addSection,
  addSectionItem,
  publishPaper,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "@/lib/papers";
import { markItem, tagItemCriteria } from "@/lib/marking";
import { addStep, recordStepOpened } from "@/lib/spine";
import { addMember, createCohort } from "@/lib/cohorts";
import { markLessonComplete, myEnrolments } from "@/lib/enrolment";
import {
  criterionCoverage,
  MINIMUM_ATTEMPTS_TO_JUDGE,
  questionPerformance,
  stepTimings,
} from "@/lib/programme-reports";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let qualificationId: string;
let moduleId: string;
let competencyId: string;
/** Three criteria: one properly tested, one only in a workbook, one nowhere. */
let tested: string;
let workbookOnly: string;
let untested: string;

let author: AuthenticatedSession;
let assessor: AuthenticatedSession;
let learners: AuthenticatedSession[] = [];

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

beforeAll(async () => {
  const slug = `preports-${Date.now()}`;

  const created = await withPlatformScope("programme reports setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Programme Reports Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId: organisation.id, title: "Test Qualification" })
      .returning({ id: qualifications.id });

    const [module] = await tx
      .insert(curriculumModules)
      .values({
        organisationId: organisation.id,
        qualificationId: qualification.id,
        component: "knowledge",
        code: "KM-01",
        title: "Knowledge Module 1",
      })
      .returning({ id: curriculumModules.id });

    const criteria = await tx
      .insert(assessmentCriteria)
      .values(
        [
          ["IAC0101", "Tested by the summative."],
          ["IAC0102", "Tested only in the workbook."],
          ["IAC0103", "Tested by nothing at all."],
        ].map(([code, description]) => ({
          organisationId: organisation.id,
          curriculumModuleId: module.id,
          code,
          description,
        })),
      )
      .returning({ id: assessmentCriteria.id, code: assessmentCriteria.code });

    const [framework] = await tx
      .insert(competencyFrameworks)
      .values({ organisationId: organisation.id, name: "Test framework" })
      .returning({ id: competencyFrameworks.id });

    const [competency] = await tx
      .insert(competencies)
      .values({
        organisationId: organisation.id,
        frameworkId: framework.id,
        code: "PR-01",
        name: "Demonstrated capability",
      })
      .returning({ id: competencies.id });

    const people = await tx
      .insert(users)
      .values(
        ["author", "assessor", "l1", "l2", "l3", "l4", "l5", "l6"].map(
          (name) => ({
            organisationId: organisation.id,
            email: `${name}@preports.test`,
            firstName: name,
            lastName: "Tester",
            status: "active" as const,
          }),
        ),
      )
      .returning({ id: users.id, email: users.email });

    const byEmail = new Map(people.map((row) => [row.email, row.id]));

    await tx.insert(userRoles).values([
      {
        organisationId: organisation.id,
        userId: byEmail.get("author@preports.test")!,
        role: "tenant_admin" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("assessor@preports.test")!,
        role: "assessor" as const,
      },
      ...["l1", "l2", "l3", "l4", "l5", "l6"].map((name) => ({
        organisationId: organisation.id,
        userId: byEmail.get(`${name}@preports.test`)!,
        role: "learner" as const,
      })),
    ]);

    return {
      organisationId: organisation.id,
      qualificationId: qualification.id,
      moduleId: module.id,
      competencyId: competency.id,
      criteria: Object.fromEntries(criteria.map((c) => [c.code, c.id])),
      ids: Object.fromEntries(byEmail),
    };
  });

  organisationId = created.organisationId;
  qualificationId = created.qualificationId;
  moduleId = created.moduleId;
  competencyId = created.competencyId;
  tested = created.criteria["IAC0101"];
  workbookOnly = created.criteria["IAC0102"];
  untested = created.criteria["IAC0103"];

  author = sessionFor(["tenant_admin"], created.ids["author@preports.test"]);
  assessor = sessionFor(["assessor"], created.ids["assessor@preports.test"]);
  learners = ["l1", "l2", "l3", "l4", "l5", "l6"].map((name) =>
    sessionFor(["learner"], created.ids[`${name}@preports.test`]),
  );
});

afterAll(async () => {
  await withPlatformScope("programme reports teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("what nothing tests", () => {
  it("reports every criterion as untested before anything is authored", async () => {
    const rows = await criterionCoverage(author, qualificationId);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.nothingTests)).toBe(true);
    expect(rows.every((row) => row.nothingTeaches)).toBe(true);
  });

  /**
   * The finding this report exists for. A criterion tested only in a workbook
   * looks assessed on any list of questions and evidences nothing, because a
   * workbook is developmental and its answers never reach the ledger.
   */
  it("distinguishes tested from tested only in a workbook", async () => {
    const course = await createCourse(author, {
      title: `Coverage ${suffix()}`,
      curriculumModuleId: moduleId,
    });

    // A lesson that teaches two of the three.
    const section = await addCourseSection(author, {
      courseId: course.id,
      title: "Section 1",
    });
    await addLesson(author, {
      sectionId: section.id,
      title: "Organisations and the value chain",
      body: "The lesson body.",
      criterionIds: [tested, workbookOnly],
    });

    const summative = await createAssessment(author, {
      courseId: course.id,
      title: "SU1 Summative",
      purpose: "summative",
      passMark: 60,
    });
    const summativePaper = await addPaper(author, {
      assessmentId: summative.id,
      code: "V1",
    });
    const summativeSection = await addSection(author, {
      paperId: summativePaper.id,
      title: "Section A",
      markTotal: 10,
    });
    const summativeItem = await addSectionItem(author, {
      sectionId: summativeSection.id,
      type: "long_answer",
      stem: "Explain the value chain.",
      markingGuide: "Marked against the rubric.",
      points: 10,
    });
    await tagItemCriteria(author, summativeItem.id, [tested]);

    const workbook = await createAssessment(author, {
      courseId: course.id,
      title: "Workbook 1",
      purpose: "formative",
    });
    const workbookPaper = await addPaper(author, {
      assessmentId: workbook.id,
      code: "W1",
    });
    const workbookSection = await addSection(author, {
      paperId: workbookPaper.id,
      title: "Activity 1.1",
      markTotal: 4,
    });
    const workbookItem = await addSectionItem(author, {
      sectionId: workbookSection.id,
      type: "long_answer",
      stem: "Practise describing the value chain.",
      markingGuide: "Developmental.",
      points: 4,
    });
    await tagItemCriteria(author, workbookItem.id, [workbookOnly]);

    const rows = await criterionCoverage(author, qualificationId);
    const byCode = new Map(rows.map((row) => [row.code, row]));

    expect(byCode.get("IAC0101")).toMatchObject({
      testedBySummative: 1,
      nothingTests: false,
      onlyFormative: false,
      nothingTeaches: false,
    });

    // The one that matters: assessed on paper, evidences nothing.
    expect(byCode.get("IAC0102")).toMatchObject({
      testedBySummative: 0,
      testedByFormative: 1,
      nothingTests: true,
      onlyFormative: true,
    });

    expect(byCode.get("IAC0103")).toMatchObject({
      testedBySummative: 0,
      testedByFormative: 0,
      nothingTests: true,
      onlyFormative: false,
      nothingTeaches: true,
    });
  });
});

describe("how each question performed", () => {
  /**
   * Six learners, six identical answers, marked very differently: one question
   * nobody can do, one everybody can, and one that actually discriminates.
   */
  async function paperSatBySix() {
    const course = await createCourse(author, {
      title: `Questions ${suffix()}`,
      curriculumModuleId: moduleId,
    });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "SU1 Summative",
      purpose: "summative",
      passMark: 60,
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section A",
      markTotal: 30,
    });

    const hard = await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "A question nobody can answer.",
      markingGuide: "Marked against the rubric.",
      points: 10,
    });
    const easy = await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "A question everybody can answer.",
      markingGuide: "Marked against the rubric.",
      points: 10,
    });
    const fair = await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "A question that discriminates.",
      markingGuide: "Marked against the rubric.",
      points: 10,
    });

    const published = await publishPaper(author, paper.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));
    await publishAssessment(author, assessment.id);

    for (const learner of learners) {
      const sitting = await startAttempt(learner, assessment.id);
      for (const sec of sitting.sections) {
        for (const item of sec.items) {
          await saveAnswer(learner, {
            submissionId: sitting.submissionId,
            itemId: item.id,
            answerText: "An answer.",
          });
        }
      }
      await submitAttempt(learner, {
        submissionId: sitting.submissionId,
        declarationAccepted: true,
      });

      await markItem(assessor, {
        submissionId: sitting.submissionId,
        itemId: hard.id,
        marks: 1,
      });
      await markItem(assessor, {
        submissionId: sitting.submissionId,
        itemId: easy.id,
        marks: 10,
      });
      await markItem(assessor, {
        submissionId: sitting.submissionId,
        itemId: fair.id,
        marks: 6,
      });
    }

    return { assessmentId: assessment.id, hard, easy, fair };
  }

  it("finds the question nobody can answer and the one everybody can", async () => {
    const { assessmentId, hard, easy, fair } = await paperSatBySix();

    const rows = await questionPerformance(author, assessmentId);
    const byId = new Map(rows.map((row) => [row.itemId, row]));

    expect(learners.length).toBeGreaterThanOrEqual(MINIMUM_ATTEMPTS_TO_JUDGE);

    expect(byId.get(hard.id)).toMatchObject({
      firstAttempts: 6,
      meanPercent: 10,
      nobodyGetsIt: true,
      everybodyGetsIt: false,
    });

    expect(byId.get(easy.id)).toMatchObject({
      meanPercent: 100,
      fullMarks: 6,
      everybodyGetsIt: true,
      nobodyGetsIt: false,
    });

    // The one that is doing its job gets no flag at all.
    expect(byId.get(fair.id)).toMatchObject({
      meanPercent: 60,
      nobodyGetsIt: false,
      everybodyGetsIt: false,
    });
  });

  /**
   * A question two people have answered tells you about those two people. The
   * flags stay off below the threshold rather than calling a paper broken on
   * the strength of one bad morning.
   */
  it("does not judge a question too few people have answered", async () => {
    const course = await createCourse(author, {
      title: `Thin ${suffix()}`,
      curriculumModuleId: moduleId,
    });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "Thin summative",
      purpose: "summative",
      passMark: 60,
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section A",
      markTotal: 10,
    });
    const item = await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "Answered by one person, badly.",
      markingGuide: "Marked against the rubric.",
      points: 10,
    });
    const published = await publishPaper(author, paper.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));
    await publishAssessment(author, assessment.id);

    const sitting = await startAttempt(learners[0], assessment.id);
    await saveAnswer(learners[0], {
      submissionId: sitting.submissionId,
      itemId: item.id,
      answerText: "An answer.",
    });
    await submitAttempt(learners[0], {
      submissionId: sitting.submissionId,
      declarationAccepted: true,
    });
    await markItem(assessor, {
      submissionId: sitting.submissionId,
      itemId: item.id,
      marks: 0,
    });

    const [row] = await questionPerformance(author, assessment.id);

    expect(row.firstAttempts).toBe(1);
    expect(row.meanPercent).toBe(0);
    expect(row.nobodyGetsIt).toBe(false);
  });

  it("reports a question nobody has sat as having no figure at all", async () => {
    const course = await createCourse(author, {
      title: `Unsat ${suffix()}`,
      curriculumModuleId: moduleId,
    });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "Unsat summative",
      purpose: "summative",
      passMark: 60,
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section A",
      markTotal: 10,
    });
    await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "Nobody has sat this.",
      markingGuide: "Marked against the rubric.",
      points: 10,
    });

    const [row] = await questionPerformance(author, assessment.id);

    expect(row.firstAttempts).toBe(0);
    expect(row.meanPercent).toBeNull();
    expect(row.nobodyGetsIt).toBe(false);
    expect(row.everybodyGetsIt).toBe(false);
  });

  it("refuses somebody without tenant reporting rights", async () => {
    await expect(
      questionPerformance(learners[0], "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow();
  });
});

describe("how long a cohort is taking", () => {
  /**
   * Two learners on a two-step course. One finishes the first step, the other
   * opens it and stops — which is the state the report exists to show, because
   * from a completion percentage the two are indistinguishable.
   */
  it("shows where a cohort is sitting", async () => {
    const course = await createCourse(author, {
      title: `Timing ${suffix()}`,
      curriculumModuleId: moduleId,
    });
    const section = await addCourseSection(author, {
      courseId: course.id,
      title: "Section 1",
    });

    const first = await addLesson(author, {
      sectionId: section.id,
      title: "Week 1 reading",
      body: "The lesson body.",
      criterionIds: [tested],
    });
    const second = await addLesson(author, {
      sectionId: section.id,
      title: "Week 2 reading",
      body: "The lesson body.",
      criterionIds: [workbookOnly, untested],
    });

    const stepOne = await addStep(author, {
      courseId: course.id,
      kind: "lesson",
      lessonId: first.id,
      title: "Week 1",
    });
    await addStep(author, {
      courseId: course.id,
      kind: "lesson",
      lessonId: second.id,
      title: "Week 2",
    });

    // The publish gate wants a competency and every criterion taught, both of
    // which a real course would have; without publishing, nobody can be
    // enrolled and there is no cohort to measure.
    await tagCourseCompetency(author, course.id, competencyId);
    const published = await publishCourse(author, course.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));

    const cohort = await createCohort(author, {
      courseId: course.id,
      name: `Intake ${suffix()}`,
      startDate: "2026-01-05",
    });

    const [finisher, stopper] = learners;
    await addMember(author, cohort.id, finisher.userId);
    await addMember(author, cohort.id, stopper.userId);

    // Joining a cohort enrols them; the enrolment is what a lesson is
    // completed against.
    const [enrolment] = await myEnrolments(finisher);

    // Both open step one; only one of them finishes it.
    await recordStepOpened(finisher, stepOne.id);
    await recordStepOpened(stopper, stepOne.id);
    await markLessonComplete(finisher, enrolment.enrolmentId, first.id);

    const rows = await stepTimings(author, cohort.id, course.id);

    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      title: "Week 1",
      opened: 2,
      completed: 1,
      inProgress: 1,
    });
    expect(rows[0].medianDays).not.toBeNull();

    // Nobody has reached the second step. Reported as untouched rather than as
    // taking no time, which is what a zero here would say.
    expect(rows[1]).toMatchObject({
      title: "Week 2",
      opened: 0,
      completed: 0,
      medianDays: null,
    });
  });

  it("counts nobody when the cohort is empty", async () => {
    const course = await createCourse(author, {
      title: `Empty ${suffix()}`,
      curriculumModuleId: moduleId,
    });
    const cohort = await createCohort(author, {
      courseId: course.id,
      name: `Empty intake ${suffix()}`,
      startDate: "2026-01-05",
    });

    const rows = await stepTimings(author, cohort.id, course.id);
    expect(rows).toEqual([]);
  });
});
