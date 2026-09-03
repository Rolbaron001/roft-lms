/**
 * Marking, and what marking means, against a live database.
 *
 * The tests that matter here are the ones guarding the wall between
 * developmental and summative work. A workbook is marked, earns marks and
 * produces feedback naming the criteria to go back to — and it must never move
 * a learner towards eligibility. If it could, somebody could accumulate their
 * way to the external assessment on practice exercises and the platform would
 * report them ready.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  curriculumModules,
  formativeFeedback,
  organisations,
  qualifications,
  rubricDescriptors,
  rubricDimensions,
  rubricLevels,
  rubrics,
  userRoles,
  users,
} from "@/db/schema";
import { createCourse } from "@/lib/authoring";
import {
  createAssessment,
  publishAssessment,
  recordAssessorDecision,
  AssessmentError,
} from "@/lib/assessment";
import {
  addPaper,
  addSection,
  addSectionItem,
  publishPaper,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "@/lib/papers";
import {
  getFeedback,
  getMarkedPaper,
  markItem,
  MarkingError,
  proposeCriterionOutcomes,
  returnFeedback,
  tagItemCriteria,
} from "@/lib/marking";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let criterionOne: string;
let criterionTwo: string;
let rubricId: string;
let dimensionIds: string[] = [];
let levelIds: string[] = [];

let author: AuthenticatedSession;
let assessor: AuthenticatedSession;
let learner: AuthenticatedSession;

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

async function createPerson(email: string, roles: Role[]) {
  return withPlatformScope("marking test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email,
        firstName: email.split("@")[0],
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });

    for (const role of roles) {
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
    return user.id;
  });
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** One structured question worth ten marks, tagged to two criteria. */
async function buildPaper(purpose: "formative" | "summative") {
  const course = await createCourse(author, { title: `Marking ${suffix()}` });
  const assessment = await createAssessment(author, {
    courseId: course.id,
    title: purpose === "summative" ? "SU1 Summative" : "Workbook 1",
    purpose,
    passMark: 60,
  });

  const paper = await addPaper(author, {
    assessmentId: assessment.id,
    code: "V1",
  });
  const section = await addSection(author, {
    paperId: paper.id,
    title: "Activity 1.3",
    markTotal: 20,
  });

  const first = await addSectionItem(author, {
    sectionId: section.id,
    type: "long_answer",
    stem: "Question 1.3.3 on economic factors",
    markingGuide: "Marked against the rubric.",
    points: 10,
  });
  const second = await addSectionItem(author, {
    sectionId: section.id,
    type: "long_answer",
    stem: "Question 1.3.4 on job evaluation tools",
    markingGuide: "Marked against the rubric.",
    points: 10,
  });

  // The question the document tags to two criteria at once.
  await tagItemCriteria(author, first.id, [criterionOne, criterionTwo]);
  await tagItemCriteria(author, second.id, [criterionTwo]);

  const published = await publishPaper(author, paper.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));
  await publishAssessment(author, assessment.id);

  return {
    assessmentId: assessment.id,
    itemIds: [first.id, second.id],
  };
}

/** Sits the paper and hands it in, leaving it ready to mark. */
async function sitAndSubmit(assessmentId: string) {
  const sitting = await startAttempt(learner, assessmentId);
  for (const section of sitting.sections) {
    for (const item of section.items) {
      await saveAnswer(learner, {
        submissionId: sitting.submissionId,
        itemId: item.id,
        answerText: "An answer of some length, referring to the principles.",
      });
    }
  }
  await submitAttempt(learner, {
    submissionId: sitting.submissionId,
    declarationAccepted: true,
  });
  return sitting.submissionId;
}

beforeAll(async () => {
  const slug = `mark-${Date.now()}`;

  const created = await withPlatformScope("marking test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Marking Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [qualification] = await tx
      .insert(qualifications)
      .values({
        organisationId: organisation.id,
        title: "Test Qualification",
      })
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
      .values([
        {
          organisationId: organisation.id,
          curriculumModuleId: module.id,
          code: "IAC0103",
          description: "Explain how economic factors influence compensation.",
        },
        {
          organisationId: organisation.id,
          curriculumModuleId: module.id,
          code: "IAC0104",
          description: "Discuss labour economics in workforce planning.",
        },
      ])
      .returning({ id: assessmentCriteria.id });

    // The four-level, three-dimension matrix the Answer Guides carry.
    const [rubric] = await tx
      .insert(rubrics)
      .values({
        organisationId: organisation.id,
        title: "Four-level evaluation matrix",
      })
      .returning({ id: rubrics.id });

    const dimensions = await tx
      .insert(rubricDimensions)
      .values(
        ["Theoretical knowledge", "Application and examples", "Analysis and synthesis"].map(
          (title, index) => ({
            organisationId: organisation.id,
            rubricId: rubric.id,
            title,
            sortOrder: index,
          }),
        ),
      )
      .returning({ id: rubricDimensions.id });

    const levels = await tx
      .insert(rubricLevels)
      .values([
        { label: "Level 4: Exemplary", minPercent: 80, maxPercent: 100 },
        { label: "Level 3: Competent", minPercent: 60, maxPercent: 75 },
        { label: "Level 2: Developing", minPercent: 40, maxPercent: 55 },
        { label: "Level 1: Unsatisfactory", minPercent: 0, maxPercent: 35 },
      ].map((level, index) => ({
        organisationId: organisation.id,
        rubricId: rubric.id,
        ...level,
        sortOrder: index,
      })))
      .returning({ id: rubricLevels.id });

    for (const dimension of dimensions) {
      for (const level of levels) {
        await tx.insert(rubricDescriptors).values({
          organisationId: organisation.id,
          dimensionId: dimension.id,
          levelId: level.id,
          descriptor: "What this level looks like on this dimension.",
        });
      }
    }

    return {
      organisationId: organisation.id,
      criteria: criteria.map((row) => row.id),
      rubricId: rubric.id,
      dimensionIds: dimensions.map((row) => row.id),
      levelIds: levels.map((row) => row.id),
    };
  });

  organisationId = created.organisationId;
  criterionOne = created.criteria[0];
  criterionTwo = created.criteria[1];
  rubricId = created.rubricId;
  dimensionIds = created.dimensionIds;
  levelIds = created.levelIds;

  author = sessionFor(
    ["tenant_admin"],
    await createPerson("author@mark.test", ["tenant_admin"]),
  );
  assessor = sessionFor(
    ["assessor"],
    await createPerson("assessor@mark.test", ["assessor"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@mark.test", ["learner"]),
  );
});

afterAll(async () => {
  await withPlatformScope("marking test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("marking one answer", () => {
  it("records a mark and what the assessor said", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, {
      submissionId,
      itemId: itemIds[0],
      marks: 7,
      comment: "Good on the macro factors; thin on wage elasticity.",
    });

    const paper = await getMarkedPaper(assessor, submissionId);
    const marked = paper.items.find((item) => item.itemId === itemIds[0])!;

    expect(marked.awarded).toBe(7);
    expect(marked.comment).toContain("wage elasticity");
    expect(paper.fullyMarked).toBe(false);
  });

  it("refuses a mark the question cannot carry", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await expect(
      markItem(assessor, { submissionId, itemId: itemIds[0], marks: 11 }),
    ).rejects.toThrow(/worth 10 marks/);

    await expect(
      markItem(assessor, { submissionId, itemId: itemIds[0], marks: -1 }),
    ).rejects.toThrow(MarkingError);
  });

  it("will not let anyone mark their own work", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    const learnerAsAssessor = sessionFor(["assessor"], learner.userId);
    await expect(
      markItem(learnerAsAssessor, {
        submissionId,
        itemId: itemIds[0],
        marks: 10,
      }),
    ).rejects.toThrow(/your own work/);
  });

  it("refuses to mark a paper still being written", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const sitting = await startAttempt(learner, assessmentId);

    await expect(
      markItem(assessor, {
        submissionId: sitting.submissionId,
        itemId: itemIds[0],
        marks: 5,
      }),
    ).rejects.toThrow(/not been handed in/);
  });
});

describe("the rubric", () => {
  /**
   * The point of a rubric: two assessors choosing the same levels reach the
   * same mark, rather than each picking a number they feel is about right.
   */
  it("turns chosen levels into a mark", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    // Level 3 on every dimension: bands 60–75, midpoint 67.5, of ten marks.
    const result = await markItemWithRubric(itemIds[0], submissionId, [
      levelIds[1],
      levelIds[1],
      levelIds[1],
    ]);
    expect(result.marks).toBe(7);

    // Level 4 throughout: 80–100, midpoint 90.
    const top = await markItemWithRubric(itemIds[1], submissionId, [
      levelIds[0],
      levelIds[0],
      levelIds[0],
    ]);
    expect(top.marks).toBe(9);
  });

  it("refuses until every dimension has a level", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);
    await attachRubric(itemIds[0]);

    await expect(
      markItem(assessor, {
        submissionId,
        itemId: itemIds[0],
        rubricLevels: { [dimensionIds[0]]: levelIds[1] },
      }),
    ).rejects.toThrow(/Choose a level for/);
  });

  it("lets an assessor override what the rubric suggests", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);
    await attachRubric(itemIds[0]);

    await markItem(assessor, {
      submissionId,
      itemId: itemIds[0],
      rubricLevels: Object.fromEntries(
        dimensionIds.map((id) => [id, levelIds[1]]),
      ),
      marks: 10,
      comment: "Rubric says 7; the answer went well beyond it.",
    });

    const paper = await getMarkedPaper(assessor, submissionId);
    expect(paper.items.find((i) => i.itemId === itemIds[0])!.awarded).toBe(10);
  });
});

async function attachRubric(itemId: string) {
  const { assessmentItems } = await import("@/db/schema");
  await withTenant(organisationId, (tx) =>
    tx
      .update(assessmentItems)
      .set({ rubricId })
      .where(eq(assessmentItems.id, itemId)),
  );
}

async function markItemWithRubric(
  itemId: string,
  submissionId: string,
  levels: string[],
) {
  await attachRubric(itemId);
  return markItem(assessor, {
    submissionId,
    itemId,
    rubricLevels: Object.fromEntries(
      dimensionIds.map((id, index) => [id, levels[index]]),
    ),
  });
}

describe("what the marks imply", () => {
  it("proposes an outcome for every criterion the questions evidence", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 8 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 9 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);
    const codes = proposals.map((p) => p.code).sort();

    expect(codes).toEqual(["IAC0103", "IAC0104"]);
    expect(proposals.every((p) => p.outcome === "competent")).toBe(true);
    // The question tagged to two criteria appears as evidence for both.
    expect(
      proposals.find((p) => p.code === "IAC0103")!.evidence,
    ).toHaveLength(1);
    expect(
      proposals.find((p) => p.code === "IAC0104")!.evidence,
    ).toHaveLength(2);
  });

  /**
   * The average across the questions evidencing a criterion, not a demand that
   * every one of them pass. The marks are not the whole picture — practical
   * performance and workplace evidence never reach the platform — so a
   * proposal that insisted on every question would be overridden constantly,
   * and a proposal overridden constantly stops being read.
   */
  it("averages across the questions evidencing a criterion", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 10 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 2 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);

    // IAC0103 rests on the strong answer alone: 10 of 10.
    const first = proposals.find((p) => p.code === "IAC0103")!;
    expect(first.percentage).toBe(100);
    expect(first.outcome).toBe("competent");

    // IAC0104 rests on both: 12 of 20, which is 60% and exactly the pass mark.
    const second = proposals.find((p) => p.code === "IAC0104")!;
    expect(second.percentage).toBe(60);
    expect(second.outcome).toBe("competent");
  });

  it("proposes not yet competent when the average falls short", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 10 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 0 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);
    const second = proposals.find((p) => p.code === "IAC0104")!;

    expect(second.percentage).toBe(50);
    expect(second.outcome).toBe("not_yet_competent");
  });
});

describe("the assessor's own call", () => {
  /**
   * The proposal is arithmetic; the decision is judgement. An assessor who has
   * watched a learner perform the task may reach a different answer, and
   * should — what the platform insists on is that the reason is written down.
   */
  it("accepts an override that says why", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 5 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 5 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);
    expect(proposals.every((p) => p.outcome === "not_yet_competent")).toBe(true);

    const proposed = Object.fromEntries(
      proposals.map((p) => [p.criterionId, p.outcome]),
    );

    const result = await recordAssessorDecision(assessor, {
      submissionId,
      outcome: "competent",
      criterionProposed: proposed,
      criterionOutcomes: Object.fromEntries(
        proposals.map((p) => [p.criterionId, "competent" as const]),
      ),
      criterionNotes: Object.fromEntries(
        proposals.map((p) => [
          p.criterionId,
          "Demonstrated in the practical simulation on 14 March, observed directly.",
        ]),
      ),
    });

    expect(result.decision.id).toBeDefined();

    const [stored] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentDecisions)
        .where(eq(assessmentDecisions.id, result.decision.id)),
    );

    // Both the arithmetic and the judgement survive, so a moderator can see
    // where they parted and read why.
    expect(Object.values(stored.criterionProposed!)).toEqual([
      "not_yet_competent",
      "not_yet_competent",
    ]);
    expect(Object.values(stored.criterionOutcomes!)).toEqual([
      "competent",
      "competent",
    ]);
    expect(Object.values(stored.criterionNotes!)[0]).toContain(
      "practical simulation",
    );
  });

  it("refuses an override that says nothing", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 3 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 3 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);

    await expect(
      recordAssessorDecision(assessor, {
        submissionId,
        outcome: "competent",
        criterionProposed: Object.fromEntries(
          proposals.map((p) => [p.criterionId, p.outcome]),
        ),
        criterionOutcomes: Object.fromEntries(
          proposals.map((p) => [p.criterionId, "competent" as const]),
        ),
      }),
    ).rejects.toThrow(/Say why/);
  });

  it("does not ask for a reason where the assessor agrees", async () => {
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 9 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 9 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);
    const outcomes = Object.fromEntries(
      proposals.map((p) => [p.criterionId, p.outcome]),
    );

    await expect(
      recordAssessorDecision(assessor, {
        submissionId,
        outcome: "competent",
        criterionProposed: outcomes,
        criterionOutcomes: outcomes,
      }),
    ).resolves.toBeDefined();
  });
});

describe("the wall", () => {
  /** Said out loud, because an empty list would be read as "no criteria". */
  it("refuses to propose criterion outcomes for a workbook", async () => {
    const { assessmentId, itemIds } = await buildPaper("formative");
    const submissionId = await sitAndSubmit(assessmentId);
    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 10 });

    await expect(
      proposeCriterionOutcomes(assessor, submissionId),
    ).rejects.toThrow(/developmental/);
  });

  /** The hole this closes: reaching the ledger through the decision path. */
  it("refuses to record competence against a workbook", async () => {
    const { assessmentId } = await buildPaper("formative");
    const submissionId = await sitAndSubmit(assessmentId);

    await expect(
      recordAssessorDecision(assessor, {
        submissionId,
        outcome: "competent",
        criterionOutcomes: { [criterionOne]: "competent" },
      }),
    ).rejects.toThrow(AssessmentError);

    await expect(
      recordAssessorDecision(assessor, {
        submissionId,
        outcome: "competent",
        criterionOutcomes: { [criterionOne]: "competent" },
      }),
    ).rejects.toThrow(/developmental/);
  });

  it("refuses to return feedback on a summative", async () => {
    const { assessmentId } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await expect(
      returnFeedback(assessor, {
        submissionId,
        comments: "This looks broadly fine to me.",
      }),
    ).rejects.toThrow(/needs an assessor's decision/);
  });
});

describe("returning a workbook", () => {
  it("gives the learner marks, comments and what to go back to", async () => {
    const { assessmentId, itemIds } = await buildPaper("formative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 4 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 8 });

    await returnFeedback(assessor, {
      submissionId,
      comments:
        "Your work on job evaluation is solid. Go back over wage elasticity before the summative.",
      criteriaOfConcern: [criterionOne],
    });

    const feedback = await getFeedback(learner, submissionId);
    expect(feedback).not.toBeNull();
    expect(feedback!.marksAwarded).toBe(12);
    expect(feedback!.marksAvailable).toBe(20);
    expect(feedback!.criteriaOfConcern.map((c) => c.code)).toEqual(["IAC0103"]);
    expect(feedback!.comments).toContain("wage elasticity");
  });

  it("refuses feedback that says nothing", async () => {
    const { assessmentId } = await buildPaper("formative");
    const submissionId = await sitAndSubmit(assessmentId);

    await expect(
      returnFeedback(assessor, { submissionId, comments: "Fine." }),
    ).rejects.toThrow(/Say something/);
  });

  it("writes nothing a decision could be mistaken for", async () => {
    const { assessmentId, itemIds } = await buildPaper("formative");
    const submissionId = await sitAndSubmit(assessmentId);
    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 10 });

    await returnFeedback(assessor, {
      submissionId,
      comments: "Well argued throughout. Nothing further needed here.",
    });

    // Feedback exists…
    const feedback = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(formativeFeedback)
        .where(eq(formativeFeedback.submissionId, submissionId)),
    );
    expect(feedback).toHaveLength(1);

    // …and no decision does. The two live in different tables precisely so
    // that one cannot become the other by accident.
    const decisions = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentDecisions)
        .where(eq(assessmentDecisions.submissionId, submissionId)),
    );
    expect(decisions).toHaveLength(0);
  });
});

/**
 * The whole chain, end to end: a question marked in the App becomes a
 * criterion in the ledger becomes a figure on the readiness screen — and a
 * workbook, marked exactly as thoroughly, moves nothing.
 *
 * This is the acceptance test for the phase. Everything else here guards one
 * link; this checks the links are actually joined, and that the wall holds
 * when they are.
 */
describe("from a marked question to readiness", () => {
  it("moves the readiness figure for a summative and not for a workbook", async () => {
    const { qualifications: quals } = await import("@/db/schema");
    const { qualificationReadiness } = await import("@/lib/eisa");

    const [qualification] = await withTenant(organisationId, (tx) =>
      tx.select().from(quals),
    );

    // Nothing achieved to begin with.
    const before = await qualificationReadiness(
      assessor,
      qualification.id,
      learner.userId,
    );
    expect(before.achievedCriteria).toBe(0);

    // --- the workbook: marked in full, and it changes nothing -------------
    const workbook = await buildPaper("formative");
    const workbookSubmission = await sitAndSubmit(workbook.assessmentId);
    await markItem(assessor, {
      submissionId: workbookSubmission,
      itemId: workbook.itemIds[0],
      marks: 10,
    });
    await markItem(assessor, {
      submissionId: workbookSubmission,
      itemId: workbook.itemIds[1],
      marks: 10,
    });
    await returnFeedback(assessor, {
      submissionId: workbookSubmission,
      comments: "Full marks throughout. Ready for the summative.",
    });

    const afterWorkbook = await qualificationReadiness(
      assessor,
      qualification.id,
      learner.userId,
    );
    expect(afterWorkbook.achievedCriteria).toBe(0);

    // --- the summative: the same marks, and it counts ---------------------
    const summative = await buildPaper("summative");
    const summativeSubmission = await sitAndSubmit(summative.assessmentId);
    await markItem(assessor, {
      submissionId: summativeSubmission,
      itemId: summative.itemIds[0],
      marks: 9,
    });
    await markItem(assessor, {
      submissionId: summativeSubmission,
      itemId: summative.itemIds[1],
      marks: 8,
    });

    // The assessor confirms what the marks propose rather than retyping it.
    const proposals = await proposeCriterionOutcomes(
      assessor,
      summativeSubmission,
    );
    expect(proposals).toHaveLength(2);

    const decision = await recordAssessorDecision(
      assessor,
      {
        submissionId: summativeSubmission,
        outcome: "competent",
        comments: "Both criteria demonstrated.",
        criterionOutcomes: Object.fromEntries(
          proposals.map((p) => [p.criterionId, p.outcome]),
        ),
      },
      // A summative is moderated in full, so the decision waits for a
      // moderator before it counts.
      { random: 0 },
    );

    const waiting = await qualificationReadiness(
      assessor,
      qualification.id,
      learner.userId,
    );
    expect(waiting.achievedCriteria).toBe(0);

    const moderator = sessionFor(
      ["moderator"],
      await createPerson(`moderator-${suffix()}@mark.test`, ["moderator"]),
    );
    const { recordModeration } = await import("@/lib/assessment");
    await recordModeration(moderator, {
      decisionId: decision.decision.id,
      outcome: "endorsed",
      comments: "Marking is consistent with the rubric.",
    });

    const after = await qualificationReadiness(
      assessor,
      qualification.id,
      learner.userId,
    );
    expect(after.achievedCriteria).toBe(2);
  });
});

/**
 * The pack an accreditation visit asks for, and the record a learner keeps.
 *
 * Both are assembly rather than new information — every piece already existed
 * somewhere. What is tested here is that the assembly does not quietly leave
 * out the parts a moderator would ask for first.
 */
describe("the moderation pack", () => {
  it("samples across the mark range rather than flatteringly", async () => {
    const { assembleModerationPack } = await import("@/lib/moderation-pack");
    const { assessmentId, itemIds } = await buildPaper("summative");

    // Six learners, marked from top to bottom.
    const marks = [20, 16, 12, 9, 5, 1];
    for (const [index, total] of marks.entries()) {
      const sitter = sessionFor(
        ["learner"],
        await createPerson(`sitter-${index}-${suffix()}@mark.test`, ["learner"]),
      );
      const sitting = await startAttempt(sitter, assessmentId);
      await submitAttempt(sitter, {
        submissionId: sitting.submissionId,
        declarationAccepted: true,
      });
      await markItem(assessor, {
        submissionId: sitting.submissionId,
        itemId: itemIds[0],
        marks: Math.min(10, total),
      });
      await markItem(assessor, {
        submissionId: sitting.submissionId,
        itemId: itemIds[1],
        marks: Math.max(0, total - 10),
      });
    }

    const moderator = sessionFor(
      ["moderator"],
      await createPerson(`mod-${suffix()}@mark.test`, ["moderator"]),
    );
    const pack = await assembleModerationPack(moderator, assessmentId, {
      sampleSize: 4,
    });

    expect(pack.counts.submissions).toBe(6);
    expect(pack.scripts).toHaveLength(4);

    // The best and the worst are both in it, which a random four need not be.
    const percentages = pack.scripts.map((script) => script.percentage);
    expect(Math.max(...percentages)).toBe(100);
    expect(Math.min(...percentages)).toBe(5);
  });

  it("carries the memorandum the marking was done against", async () => {
    const { assembleModerationPack } = await import("@/lib/moderation-pack");
    const { assessmentId } = await buildPaper("summative");

    const moderator = sessionFor(
      ["moderator"],
      await createPerson(`mod-${suffix()}@mark.test`, ["moderator"]),
    );
    const pack = await assembleModerationPack(moderator, assessmentId);

    expect(pack.memorandum).toHaveLength(2);
    expect(pack.memorandum[0].markingGuide).toContain("rubric");
    expect(pack.assessment.moderationSampleRate).toBe(1);
  });

  /** The part a pack is most tempted to omit. */
  it("shows where an assessor departed from what the marks proposed", async () => {
    const { assembleModerationPack } = await import("@/lib/moderation-pack");
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, { submissionId, itemId: itemIds[0], marks: 4 });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 4 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);
    await recordAssessorDecision(assessor, {
      submissionId,
      outcome: "competent",
      criterionProposed: Object.fromEntries(
        proposals.map((p) => [p.criterionId, p.outcome]),
      ),
      criterionOutcomes: Object.fromEntries(
        proposals.map((p) => [p.criterionId, "competent" as const]),
      ),
      criterionNotes: Object.fromEntries(
        proposals.map((p) => [
          p.criterionId,
          "Observed performing the task in the workplace on 3 April.",
        ]),
      ),
    });

    const moderator = sessionFor(
      ["moderator"],
      await createPerson(`mod-${suffix()}@mark.test`, ["moderator"]),
    );
    const pack = await assembleModerationPack(moderator, assessmentId);

    expect(pack.overturned.length).toBeGreaterThan(0);
    const departure = pack.overturned[0].departures[0];
    expect(departure.proposed).toBe("not_yet_competent");
    expect(departure.decided).toBe("competent");
    expect(departure.reason).toContain("workplace");
  });

  it("is not offered to somebody who cannot moderate", async () => {
    const { assembleModerationPack } = await import("@/lib/moderation-pack");
    const { assessmentId } = await buildPaper("summative");
    await expect(
      assembleModerationPack(learner, assessmentId),
    ).rejects.toThrow();
  });
});

describe("a learner's own record", () => {
  it("holds the questions, the answers, the marks and who signed", async () => {
    const { portfolioRecord } = await import("@/lib/moderation-pack");
    const { assessmentId, itemIds } = await buildPaper("summative");
    const submissionId = await sitAndSubmit(assessmentId);

    await markItem(assessor, {
      submissionId,
      itemId: itemIds[0],
      marks: 8,
      comment: "Well argued.",
    });
    await markItem(assessor, { submissionId, itemId: itemIds[1], marks: 7 });

    const proposals = await proposeCriterionOutcomes(assessor, submissionId);
    await recordAssessorDecision(assessor, {
      submissionId,
      outcome: "competent",
      comments: "Both criteria demonstrated.",
      criterionProposed: Object.fromEntries(
        proposals.map((p) => [p.criterionId, p.outcome]),
      ),
      criterionOutcomes: Object.fromEntries(
        proposals.map((p) => [p.criterionId, p.outcome]),
      ),
    });

    const record = await portfolioRecord(learner, submissionId);

    expect(record.items).toHaveLength(2);
    expect(record.items[0].awarded).toBe(8);
    expect(record.items[0].comment).toBe("Well argued.");
    expect(record.marksAwarded).toBe(15);
    expect(record.marksAvailable).toBe(20);
    expect(record.decision?.outcome).toBe("competent");
    expect(record.decision?.assessor).toContain("Tester");
    // The declaration is part of the record, not a step on the way to it.
    expect(record.declarationText).toContain("my own work");
    expect(record.declarationAcceptedAt).not.toBeNull();
  });

  it("says plainly where a question was left blank", async () => {
    const { portfolioRecord } = await import("@/lib/moderation-pack");
    const { assessmentId } = await buildPaper("formative");

    const sitting = await startAttempt(learner, assessmentId);
    await submitAttempt(learner, {
      submissionId: sitting.submissionId,
      declarationAccepted: true,
    });

    const record = await portfolioRecord(learner, sitting.submissionId);
    expect(record.items[0].answer).toContain("left blank");
  });

  it("will not hand one learner another learner's record", async () => {
    const { portfolioRecord } = await import("@/lib/moderation-pack");
    const { assessmentId } = await buildPaper("formative");
    const submissionId = await sitAndSubmit(assessmentId);

    const stranger = sessionFor(
      ["learner"],
      await createPerson(`stranger-${suffix()}@mark.test`, ["learner"]),
    );
    await expect(portfolioRecord(stranger, submissionId)).rejects.toThrow();
  });
});
