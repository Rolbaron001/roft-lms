/**
 * Sitting a paper, against a live database.
 *
 * Built around Workbook 1 of Study Unit 1 as it is actually shaped: three
 * activities, four multiple-choice, four true/false and five structured
 * questions, fifty-eight marks. Each test here guards a way answering on
 * screen could be worse than the Word file it replaces — a leaked memorandum,
 * lost work, a paper that changed after it was sat, or evidence nobody
 * attested to.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentSubmissions,
  competencies,
  competencyFrameworks,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import { createCourse } from "@/lib/authoring";
import { createAssessment, publishAssessment } from "@/lib/assessment";
import {
  addPaper,
  addSection,
  addSectionItem,
  closeExpiredAttempt,
  getSitting,
  PaperError,
  paperProblems,
  publishPaper,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "@/lib/papers";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let author: AuthenticatedSession;
let learner: AuthenticatedSession;
let other: AuthenticatedSession;

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
  };
}

async function createPerson(email: string, roles: Role[]) {
  return withPlatformScope("paper test fixture", async (tx) => {
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

/**
 * Workbook 1, as the document has it: Activity 1.1 four marks, 1.2 four marks,
 * 1.3 fifty marks, fifty-eight in total.
 */
async function buildWorkbook(
  overrides: {
    purpose?: "formative" | "summative";
    timeLimitMinutes?: number;
    maxAttempts?: number;
  } = {},
) {
  const course = await createCourse(author, { title: `SU1 ${suffix()}` });
  const assessment = await createAssessment(author, {
    courseId: course.id,
    title: "Workbook 1: Strategic HRM and Job Architecture",
    purpose: overrides.purpose ?? "formative",
    ...(overrides.timeLimitMinutes
      ? { timeLimitMinutes: overrides.timeLimitMinutes }
      : {}),
    ...(overrides.maxAttempts ? { maxAttempts: overrides.maxAttempts } : {}),
  });

  const paper = await addPaper(author, {
    assessmentId: assessment.id,
    code: "V1",
  });

  const mcq = await addSection(author, {
    paperId: paper.id,
    title: "Activity 1.1: Multiple Choice Questions",
    instruction: "Select the most appropriate answer for each question.",
    markTotal: 4,
  });
  for (let index = 1; index <= 4; index += 1) {
    await addSectionItem(author, {
      sectionId: mcq.id,
      type: "multiple_choice",
      stem: `Multiple choice ${index}`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndexes: [1],
      points: 1,
    });
  }

  const trueFalse = await addSection(author, {
    paperId: paper.id,
    title: "Activity 1.2: True / False Statements",
    markTotal: 4,
  });
  for (let index = 1; index <= 4; index += 1) {
    await addSectionItem(author, {
      sectionId: trueFalse.id,
      type: "true_false",
      stem: `Statement ${index}`,
      options: ["True", "False"],
      correctIndexes: [index % 2],
      points: 1,
    });
  }

  const structured = await addSection(author, {
    paperId: paper.id,
    title: "Activity 1.3: Short Answer and Structured Questions",
    instruction:
      "Answer the following in detail, referencing theoretical principles where appropriate.",
    markTotal: 50,
  });
  for (let index = 1; index <= 5; index += 1) {
    await addSectionItem(author, {
      sectionId: structured.id,
      type: "long_answer",
      stem: `Structured question 1.3.${index}`,
      markingGuide: "Award marks against the four-level rubric.",
      points: 10,
    });
  }

  const published = await publishPaper(author, paper.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));
  await publishAssessment(author, assessment.id);

  return { courseId: course.id, assessmentId: assessment.id, paperId: paper.id };
}

beforeAll(async () => {
  const slug = `paper-${Date.now()}`;

  organisationId = await withPlatformScope("paper test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Paper Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [framework] = await tx
      .insert(competencyFrameworks)
      .values({ organisationId: organisation.id, name: "Framework" })
      .returning({ id: competencyFrameworks.id });

    // A framework and a competency exist because a course needs something to
    // be tagged to before it can be published; nothing here reads them back.
    await tx.insert(competencies).values({
      organisationId: organisation.id,
      frameworkId: framework.id,
      code: "PPR-01",
      name: "Demonstrated capability",
    });

    return organisation.id;
  });

  author = sessionFor(
    ["tenant_admin"],
    await createPerson("author@paper.test", ["tenant_admin"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@paper.test", ["learner"]),
  );
  other = sessionFor(
    ["learner"],
    await createPerson("other@paper.test", ["learner"]),
  );
});

afterAll(async () => {
  await withPlatformScope("paper test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("a paper as the learner sees it", () => {
  it("presents Workbook 1 in its three activities, fifty-eight marks", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);

    expect(sitting.sections.map((section) => section.title)).toEqual([
      "Activity 1.1: Multiple Choice Questions",
      "Activity 1.2: True / False Statements",
      "Activity 1.3: Short Answer and Structured Questions",
    ]);
    expect(sitting.sections.map((section) => section.items.length)).toEqual([
      4, 4, 5,
    ]);
    expect(sitting.totalMarks).toBe(58);
    expect(sitting.attemptNumber).toBe(1);
    expect(sitting.paperCode).toBe("V1");
  });

  /**
   * The memorandum is absent by construction rather than hidden by a template.
   * A template can be wrong; a column that was never selected cannot leak.
   */
  it("carries no hint of which answer is correct", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);

    const serialised = JSON.stringify(sitting);
    expect(serialised).not.toContain("correctOptionIds");
    expect(serialised).not.toContain("markingGuide");
    expect(serialised).not.toContain("rubric");

    for (const section of sitting.sections) {
      for (const item of section.items) {
        for (const option of item.options ?? []) {
          expect(Object.keys(option).sort()).toEqual(["id", "text"]);
        }
      }
    }
  });

  it("shows a section its own stimulus, once", async () => {
    const course = await createCourse(author, { title: `Scenario ${suffix()}` });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "Summative",
      purpose: "formative",
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section C",
      stimulus:
        "Nexus Logistics operates three hubs. Overall Equipment Effectiveness has fallen from 85% to 64%.",
      markTotal: 20,
    });
    await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "Question C1",
      markingGuide: "Rubric.",
      points: 20,
    });
    const published = await publishPaper(author, paper.id);
    expect(published.ok).toBe(true);
    await publishAssessment(author, assessment.id);

    const sitting = await startAttempt(learner, assessment.id);
    expect(sitting.sections[0].stimulus).toContain("Nexus Logistics");
  });
});

describe("answers", () => {
  it("saves one question at a time and comes back to them", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);
    const first = sitting.sections[0].items[0];
    const essay = sitting.sections[2].items[0];

    await saveAnswer(learner, {
      submissionId: sitting.submissionId,
      itemId: first.id,
      selectedOptionIds: [first.options![1].id],
    });
    await saveAnswer(learner, {
      submissionId: sitting.submissionId,
      itemId: essay.id,
      answerText: "A functional structure concentrates expertise…",
    });

    // Coming back resumes the same attempt rather than starting a new one.
    const resumed = await startAttempt(learner, assessmentId);
    expect(resumed.submissionId).toBe(sitting.submissionId);
    expect(resumed.attemptNumber).toBe(1);
    expect(resumed.sections[0].items[0].answer.selectedOptionIds).toEqual([
      first.options![1].id,
    ]);
    expect(resumed.sections[2].items[0].answer.answerText).toContain(
      "functional structure",
    );
  });

  it("replaces an answer rather than keeping both", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);
    const item = sitting.sections[0].items[0];

    await saveAnswer(learner, {
      submissionId: sitting.submissionId,
      itemId: item.id,
      selectedOptionIds: [item.options![0].id],
    });
    await saveAnswer(learner, {
      submissionId: sitting.submissionId,
      itemId: item.id,
      selectedOptionIds: [item.options![2].id],
    });

    const again = await getSitting(learner, sitting.submissionId);
    expect(again.sections[0].items[0].answer.selectedOptionIds).toEqual([
      item.options![2].id,
    ]);
  });

  it("will not let one learner write into another's paper", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);
    const item = sitting.sections[0].items[0];

    await expect(
      saveAnswer(other, {
        submissionId: sitting.submissionId,
        itemId: item.id,
        selectedOptionIds: [item.options![0].id],
      }),
    ).rejects.toThrow(PaperError);

    await expect(getSitting(other, sitting.submissionId)).rejects.toThrow(
      /belongs to someone else/,
    );
  });
});

describe("handing in", () => {
  /** The declaration is the control that makes the work attributable. */
  it("refuses without the declaration", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);

    const refused = await submitAttempt(learner, {
      submissionId: sitting.submissionId,
      declarationAccepted: false,
    });

    expect(refused.ok).toBe(false);
    expect(refused.reasons[0]).toContain("declaration");

    const still = await getSitting(learner, sitting.submissionId);
    expect(still.status).toBe("draft");
  });

  it("freezes the wording that was agreed to", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);

    const result = await submitAttempt(learner, {
      submissionId: sitting.submissionId,
      declarationAccepted: true,
    });
    expect(result.ok).toBe(true);

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentSubmissions)
        .where(eq(assessmentSubmissions.id, sitting.submissionId)),
    );

    expect(row.declarationAcceptedAt).not.toBeNull();
    expect(row.declarationText).toContain("my own work");
    expect(row.status).toBe("finalised");
  });

  it("counts what was left blank without refusing it", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);
    const item = sitting.sections[0].items[0];

    await saveAnswer(learner, {
      submissionId: sitting.submissionId,
      itemId: item.id,
      selectedOptionIds: [item.options![1].id],
    });

    const result = await submitAttempt(learner, {
      submissionId: sitting.submissionId,
      declarationAccepted: true,
    });

    expect(result.ok).toBe(true);
    expect(result.unanswered).toBe(12);
  });

  it("refuses to change a paper already handed in", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);
    const item = sitting.sections[0].items[0];

    await submitAttempt(learner, {
      submissionId: sitting.submissionId,
      declarationAccepted: true,
    });

    await expect(
      saveAnswer(learner, {
        submissionId: sitting.submissionId,
        itemId: item.id,
        selectedOptionIds: [item.options![0].id],
      }),
    ).rejects.toThrow(/already been handed in/);
  });

  /** A summative waits for a person; a workbook has nobody to wait for. */
  it("sends a summative to an assessor and finishes a workbook", async () => {
    const workbook = await buildWorkbook({ purpose: "formative" });
    const summative = await buildWorkbook({ purpose: "summative" });

    const one = await startAttempt(learner, workbook.assessmentId);
    await submitAttempt(learner, {
      submissionId: one.submissionId,
      declarationAccepted: true,
    });
    expect((await getSitting(learner, one.submissionId)).status).toBe(
      "finalised",
    );

    const two = await startAttempt(learner, summative.assessmentId);
    await submitAttempt(learner, {
      submissionId: two.submissionId,
      declarationAccepted: true,
    });
    expect((await getSitting(learner, two.submissionId)).status).toBe(
      "submitted",
    );
  });
});

describe("the clock", () => {
  it("tells the learner when it closes", async () => {
    const { assessmentId } = await buildWorkbook({ timeLimitMinutes: 150 });
    const sitting = await startAttempt(learner, assessmentId);

    expect(sitting.closesAt).not.toBeNull();
    const minutes =
      (sitting.closesAt!.getTime() - sitting.startedAt!.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(150);
  });

  /**
   * Time running out must not discard the work. A dropped connection is not
   * cheating, and the limit exists to bound the sitting, not to punish one.
   */
  it("hands in what was saved when time runs out", async () => {
    const { assessmentId } = await buildWorkbook({ timeLimitMinutes: 30 });
    const sitting = await startAttempt(learner, assessmentId);
    const item = sitting.sections[0].items[0];

    await saveAnswer(learner, {
      submissionId: sitting.submissionId,
      itemId: item.id,
      selectedOptionIds: [item.options![1].id],
    });

    // Wind the start back beyond the limit.
    await withTenant(organisationId, (tx) =>
      tx
        .update(assessmentSubmissions)
        .set({ startedAt: new Date(Date.now() - 31 * 60_000) })
        .where(eq(assessmentSubmissions.id, sitting.submissionId)),
    );

    await expect(
      saveAnswer(learner, {
        submissionId: sitting.submissionId,
        itemId: item.id,
        selectedOptionIds: [item.options![2].id],
      }),
    ).rejects.toThrow(/Time is up/);

    expect(await closeExpiredAttempt(learner, sitting.submissionId)).toBe(true);

    const after = await getSitting(learner, sitting.submissionId);
    expect(after.status).toBe("finalised");
    // The answer given before the clock ran out survived.
    expect(after.sections[0].items[0].answer.selectedOptionIds).toEqual([
      item.options![1].id,
    ]);

    // And the record does not claim the learner attested to anything.
    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentSubmissions)
        .where(eq(assessmentSubmissions.id, sitting.submissionId)),
    );
    expect(row.declarationAcceptedAt).toBeNull();
  });

  it("leaves an attempt alone while there is time left", async () => {
    const { assessmentId } = await buildWorkbook({ timeLimitMinutes: 60 });
    const sitting = await startAttempt(learner, assessmentId);
    expect(await closeExpiredAttempt(learner, sitting.submissionId)).toBe(false);
    expect((await getSitting(learner, sitting.submissionId)).status).toBe(
      "draft",
    );
  });
});

describe("attempts and papers", () => {
  it("gives the second attempt the second paper", async () => {
    const { assessmentId } = await buildWorkbook();

    // A second parallel form of the same assessment.
    const v2 = await addPaper(author, { assessmentId, code: "V2" });
    const section = await addSection(author, {
      paperId: v2.id,
      title: "Section A",
      markTotal: 1,
    });
    await addSectionItem(author, {
      sectionId: section.id,
      type: "true_false",
      stem: "A different question",
      options: ["True", "False"],
      correctIndexes: [0],
      points: 1,
    });
    const published = await publishPaper(author, v2.id);
    expect(published.ok).toBe(true);

    const first = await startAttempt(learner, assessmentId);
    expect(first.paperCode).toBe("V1");
    await submitAttempt(learner, {
      submissionId: first.submissionId,
      declarationAccepted: true,
    });

    const second = await startAttempt(learner, assessmentId);
    expect(second.paperCode).toBe("V2");
    expect(second.attemptNumber).toBe(2);
  });

  it("refuses once the attempts are used up", async () => {
    const { assessmentId } = await buildWorkbook({ maxAttempts: 1 });

    const first = await startAttempt(learner, assessmentId);
    await submitAttempt(learner, {
      submissionId: first.submissionId,
      declarationAccepted: true,
    });

    await expect(startAttempt(learner, assessmentId)).rejects.toThrow(
      /all 1 attempts/,
    );
  });

  /**
   * An author correcting a question next month must not change the paper a
   * learner already sat.
   */
  it("keeps the paper as it was presented", async () => {
    const { assessmentId } = await buildWorkbook();
    const sitting = await startAttempt(learner, assessmentId);

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentSubmissions)
        .where(eq(assessmentSubmissions.id, sitting.submissionId)),
    );

    const frozen = row.frozenPaper as {
      sections: { title: string; items: { stem: string }[] }[];
    };
    expect(frozen.sections).toHaveLength(3);
    expect(frozen.sections[0].items[0].stem).toBe("Multiple choice 1");
    expect(JSON.stringify(frozen)).not.toContain("correctOptionIds");
  });
});

describe("a paper that does not add up", () => {
  it("refuses to publish when a section disagrees with its questions", async () => {
    const course = await createCourse(author, { title: `Bad ${suffix()}` });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "Mismatched",
      purpose: "formative",
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section A",
      markTotal: 15,
    });
    await addSectionItem(author, {
      sectionId: section.id,
      type: "true_false",
      stem: "One question",
      options: ["True", "False"],
      correctIndexes: [0],
      points: 1,
    });

    const result = await publishPaper(author, paper.id);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain("15 marks");
    expect(result.reasons[0]).toContain("add up to 1");
  });

  it("refuses a section with no questions", async () => {
    const course = await createCourse(author, { title: `Empty ${suffix()}` });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "Empty",
      purpose: "formative",
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    await addSection(author, { paperId: paper.id, title: "Section A" });

    const result = await publishPaper(author, paper.id);
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain("no questions");
  });

  it("names a structured question with no marking guidance", async () => {
    const course = await createCourse(author, { title: `NoGuide ${suffix()}` });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "No guidance",
      purpose: "formative",
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section C",
      markTotal: 10,
    });
    await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "Discuss how organisational structures affect HR architecture",
      points: 10,
    });

    const problems = await paperProblems(author, paper.id);
    expect(problems.some((problem) => problem.includes("marking guidance"))).toBe(
      true,
    );
  });

  it("refuses a chosen-answer question with no correct answer recorded", async () => {
    const course = await createCourse(author, { title: `NoKey ${suffix()}` });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "No key",
      purpose: "formative",
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section A",
    });

    await expect(
      addSectionItem(author, {
        sectionId: section.id,
        type: "multiple_choice",
        stem: "Which one?",
        options: ["A", "B"],
        points: 1,
      }),
    ).rejects.toThrow(/correct answer recorded/);
  });
});
