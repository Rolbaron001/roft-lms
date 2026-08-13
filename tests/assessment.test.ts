/**
 * Assessment, assessor decisions and moderation, against a live database.
 *
 * These are the behaviours a QCTO verifier would probe. Each has a silent
 * failure mode - a portfolio that looks complete but was self-assessed, a
 * moderator who signed off their own judgement, an overridden result reported
 * as the original - so each is tested rather than assumed.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  auditLog,
  competencies,
  competencyFrameworks,
  evidenceArtifacts,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  addLesson,
  addSection,
  createCourse,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import {
  addAssessmentItem,
  AssessmentError,
  createAssessment,
  effectiveOutcome,
  getAssessmentForLearner,
  listAssessorQueue,
  listModerationQueue,
  markResponses,
  publishAssessment,
  recordAssessorDecision,
  recordModeration,
  shouldModerate,
  submitEvidence,
  submitQuiz,
} from "@/lib/assessment";
import { hashBytes, verifyIntegrity } from "@/lib/storage";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let competencyId: string;
let admin: AuthenticatedSession;
let assessorA: AuthenticatedSession;
let assessorB: AuthenticatedSession;
let moderator: AuthenticatedSession;
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
  };
}

async function createPerson(email: string, roles: Role[]) {
  return withPlatformScope("assessment test fixture", async (tx) => {
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
      await tx
        .insert(userRoles)
        .values({ organisationId, userId: user.id, role });
    }

    return user.id;
  });
}

async function publishedCourse(title: string) {
  const course = await createCourse(admin, { title });
  const section = await addSection(admin, { courseId: course.id, title: "S1" });
  await addLesson(admin, { sectionId: section.id, title: "L1" });
  await tagCourseCompetency(admin, course.id, competencyId);
  const result = await publishCourse(admin, course.id);
  if (!result.ok) throw new Error(result.reasons.join(" "));
  return course.id;
}

/** A published quiz with two single-answer questions worth one point each. */
async function publishedQuiz(options?: {
  purpose?: "formative" | "summative";
  sampleRate?: number;
}) {
  const courseId = await publishedCourse(`Quiz course ${randomSuffix()}`);

  const assessment = await createAssessment(admin, {
    courseId,
    title: "Knowledge check",
    purpose: options?.purpose ?? "formative",
    passMark: 70,
    moderationSampleRate: options?.sampleRate ?? 0.25,
  });

  const first = await addAssessmentItem(admin, {
    assessmentId: assessment.id,
    stem: "Who holds the general duty to provide a safe working environment?",
    options: ["The employer", "The learner", "The regulator"],
    correctIndexes: [0],
  });

  const second = await addAssessmentItem(admin, {
    assessmentId: assessment.id,
    stem: "A hazard is best described as...",
    options: ["Anything with the potential to cause harm", "An injury"],
    correctIndexes: [0],
  });

  await publishAssessment(admin, assessment.id);

  return { courseId, assessmentId: assessment.id, items: [first, second] };
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

beforeAll(async () => {
  const slug = `assess-${Date.now()}`;

  const created = await withPlatformScope(
    "assessment test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Assessment Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [framework] = await tx
        .insert(competencyFrameworks)
        .values({ organisationId: organisation.id, name: "Framework" })
        .returning({ id: competencyFrameworks.id });

      const [competency] = await tx
        .insert(competencies)
        .values({
          organisationId: organisation.id,
          frameworkId: framework.id,
          code: "ASM-01",
          name: "Test competency",
        })
        .returning({ id: competencies.id });

      return { organisationId: organisation.id, competencyId: competency.id };
    },
  );

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  admin = sessionFor(
    ["tenant_admin"],
    await createPerson("admin@assess.test", ["tenant_admin"]),
  );
  assessorA = sessionFor(
    ["assessor"],
    await createPerson("assessor-a@assess.test", ["assessor"]),
  );
  assessorB = sessionFor(
    ["assessor"],
    await createPerson("assessor-b@assess.test", ["assessor"]),
  );
  moderator = sessionFor(
    ["moderator"],
    await createPerson("moderator@assess.test", ["moderator"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@assess.test", ["learner"]),
  );
});

afterAll(async () => {
  await withPlatformScope("assessment test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("marking", () => {
  const items = [
    { id: "a", points: 1, correctOptionIds: ["a1"] },
    { id: "b", points: 2, correctOptionIds: ["b1", "b2"] },
  ];

  it("awards a point for a correct single answer", () => {
    expect(markResponses(items, { a: ["a1"] })).toEqual({
      score: 1,
      maxScore: 3,
    });
  });

  it("gives nothing for a wrong answer", () => {
    expect(markResponses(items, { a: ["a2"] }).score).toBe(0);
  });

  /** Partial credit would let a learner pass by ticking every option. */
  it("gives no partial credit on a multiple-response question", () => {
    expect(markResponses(items, { b: ["b1"] }).score).toBe(0);
  });

  it("gives no credit for selecting everything", () => {
    expect(markResponses(items, { b: ["b1", "b2", "b3"] }).score).toBe(0);
  });

  it("awards full marks when the selected set matches exactly", () => {
    expect(markResponses(items, { b: ["b2", "b1"] }).score).toBe(2);
  });

  it("handles an unanswered paper", () => {
    expect(markResponses(items, {})).toEqual({ score: 0, maxScore: 3 });
  });
});

describe("authoring an assessment", () => {
  it("refuses a question whose options have no correct answer", async () => {
    const courseId = await publishedCourse(`No answer ${randomSuffix()}`);
    const assessment = await createAssessment(admin, {
      courseId,
      title: "Broken quiz",
    });

    await expect(
      addAssessmentItem(admin, {
        assessmentId: assessment.id,
        stem: "Unanswerable",
        options: ["One", "Two"],
        correctIndexes: [],
      }),
    ).rejects.toBeInstanceOf(AssessmentError);
  });

  it("refuses a correct answer that is not one of the options", async () => {
    const courseId = await publishedCourse(`Bad index ${randomSuffix()}`);
    const assessment = await createAssessment(admin, {
      courseId,
      title: "Broken quiz",
    });

    await expect(
      addAssessmentItem(admin, {
        assessmentId: assessment.id,
        stem: "Out of range",
        options: ["One", "Two"],
        correctIndexes: [5],
      }),
    ).rejects.toBeInstanceOf(AssessmentError);
  });

  it("refuses to publish a quiz with no questions", async () => {
    const courseId = await publishedCourse(`Empty quiz ${randomSuffix()}`);
    const assessment = await createAssessment(admin, {
      courseId,
      title: "Empty quiz",
    });

    await expect(
      publishAssessment(admin, assessment.id),
    ).rejects.toBeInstanceOf(AssessmentError);
  });

  it("stops a learner authoring an assessment", async () => {
    const courseId = await publishedCourse(`Learner authoring ${randomSuffix()}`);
    await expect(
      createAssessment(learner, { courseId, title: "Mine now" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  /** A summative decision must always be moderated, whatever rate was typed. */
  it("forces full moderation on a summative assessment", async () => {
    const courseId = await publishedCourse(`Summative ${randomSuffix()}`);
    const assessment = await createAssessment(admin, {
      courseId,
      title: "Summative",
      purpose: "summative",
      moderationSampleRate: 0.1,
    });

    expect(Number(assessment.moderationSampleRate)).toBe(1);
  });
});

describe("taking a quiz", () => {
  it("never sends the correct answers to the learner", async () => {
    const { assessmentId } = await publishedQuiz();
    const view = await getAssessmentForLearner(learner, assessmentId);

    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("correctOptionIds");

    for (const item of view.items) {
      expect(Object.keys(item)).not.toContain("correctOptionIds");
    }
  });

  it("marks a correct paper and passes it", async () => {
    const { assessmentId, items } = await publishedQuiz();

    const result = await submitQuiz(learner, {
      assessmentId,
      responses: {
        [items[0].id]: [items[0].options![0].id],
        [items[1].id]: [items[1].options![0].id],
      },
    });

    expect(result.score).toBe(2);
    expect(result.maxScore).toBe(2);
    expect(result.passed).toBe(true);
    expect(result.awaitingAssessor).toBe(false);
  });

  it("fails a paper below the pass mark", async () => {
    const { assessmentId, items } = await publishedQuiz();

    const result = await submitQuiz(learner, {
      assessmentId,
      responses: { [items[0].id]: [items[0].options![1].id] },
    });

    expect(result.passed).toBe(false);
  });

  it("sends a summative attempt to an assessor rather than finalising it", async () => {
    const { assessmentId, items } = await publishedQuiz({
      purpose: "summative",
    });

    const result = await submitQuiz(learner, {
      assessmentId,
      responses: { [items[0].id]: [items[0].options![0].id] },
    });

    expect(result.awaitingAssessor).toBe(true);

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentSubmissions)
        .where(eq(assessmentSubmissions.id, result.submissionId)),
    );
    expect(row.status).toBe("submitted");
  });

  it("numbers repeat attempts", async () => {
    const { assessmentId, items } = await publishedQuiz();
    await submitQuiz(learner, { assessmentId, responses: {} });
    await submitQuiz(learner, {
      assessmentId,
      responses: { [items[0].id]: [items[0].options![0].id] },
    });

    const view = await getAssessmentForLearner(learner, assessmentId);
    expect(view.attempts.map((a) => a.attemptNumber)).toEqual([2, 1]);
  });

  it("stops a learner exceeding the attempt limit", async () => {
    const courseId = await publishedCourse(`Limited ${randomSuffix()}`);
    const assessment = await createAssessment(admin, {
      courseId,
      title: "One shot",
      maxAttempts: 1,
    });
    await addAssessmentItem(admin, {
      assessmentId: assessment.id,
      stem: "Only question",
      options: ["Right", "Wrong"],
      correctIndexes: [0],
    });
    await publishAssessment(admin, assessment.id);

    await submitQuiz(learner, { assessmentId: assessment.id, responses: {} });

    await expect(
      submitQuiz(learner, { assessmentId: assessment.id, responses: {} }),
    ).rejects.toMatchObject({ code: "no_attempts_left" });
  });

  it("refuses an unpublished assessment", async () => {
    const courseId = await publishedCourse(`Unpublished ${randomSuffix()}`);
    const assessment = await createAssessment(admin, {
      courseId,
      title: "Draft quiz",
    });

    await expect(
      submitQuiz(learner, { assessmentId: assessment.id, responses: {} }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("records the submission in the audit log", async () => {
    const { assessmentId } = await publishedQuiz();
    const result = await submitQuiz(learner, { assessmentId, responses: {} });

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, result.submissionId)),
    );

    expect(entries.map((e) => e.action)).toContain("assessment.submitted");
  });
});

describe("evidence", () => {
  async function evidenceAssessment() {
    const courseId = await publishedCourse(`Evidence ${randomSuffix()}`);
    const assessment = await createAssessment(admin, {
      courseId,
      title: "Workplace logbook",
      type: "evidence_submission",
      purpose: "summative",
    });
    await publishAssessment(admin, assessment.id);
    return assessment.id;
  }

  it("hashes an uploaded file and stores the hash beside it", async () => {
    const assessmentId = await evidenceAssessment();
    const bytes = new TextEncoder().encode("Logbook entry for week 1.");

    const result = await submitEvidence(learner, {
      assessmentId,
      files: [
        { filename: "logbook.txt", mimeType: "text/plain", bytes },
      ],
    });

    expect(result.files[0].sha256).toBe(hashBytes(bytes));

    const [artifact] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(evidenceArtifacts)
        .where(eq(evidenceArtifacts.submissionId, result.submissionId)),
    );

    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.uploadedById).toBe(learner.userId);
  });

  /**
   * The property the whole Portfolio of Evidence rests on: a stored file that
   * has been altered no longer matches the hash recorded at submission.
   */
  it("detects an altered file", async () => {
    const assessmentId = await evidenceAssessment();
    const original = new TextEncoder().encode("Original evidence.");

    const result = await submitEvidence(learner, {
      assessmentId,
      files: [{ filename: "e.txt", mimeType: "text/plain", bytes: original }],
    });

    const [artifact] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(evidenceArtifacts)
        .where(eq(evidenceArtifacts.submissionId, result.submissionId)),
    );

    expect(await verifyIntegrity(artifact.storageKey, artifact.sha256)).toBe(
      true,
    );

    // Tamper with the stored bytes directly, as someone with file access could.
    const { putObject } = await import("@/lib/storage");
    await putObject(
      artifact.storageKey,
      new TextEncoder().encode("Altered evidence."),
    );

    expect(await verifyIntegrity(artifact.storageKey, artifact.sha256)).toBe(
      false,
    );
  });

  it("refuses a submission with no files attached", async () => {
    const assessmentId = await evidenceAssessment();
    await expect(
      submitEvidence(learner, { assessmentId, files: [] }),
    ).rejects.toBeInstanceOf(AssessmentError);
  });
});

describe("sampling rule", () => {
  it("moderates everything when the rate is one", () => {
    expect(
      shouldModerate({
        sampleRate: 1,
        isNewAssessor: false,
        moderateAllForNewAssessors: true,
        random: 0.99,
      }),
    ).toEqual({ moderate: true, reason: "full_moderation" });
  });

  it("moderates a new assessor in full whatever the rate", () => {
    expect(
      shouldModerate({
        sampleRate: 0.05,
        isNewAssessor: true,
        moderateAllForNewAssessors: true,
        random: 0.99,
      }),
    ).toEqual({ moderate: true, reason: "new_assessor" });
  });

  it("samples at the configured rate for an established assessor", () => {
    const common = {
      sampleRate: 0.25,
      isNewAssessor: false,
      moderateAllForNewAssessors: true,
    };
    expect(shouldModerate({ ...common, random: 0.1 }).moderate).toBe(true);
    expect(shouldModerate({ ...common, random: 0.9 }).moderate).toBe(false);
  });

  it("moderates nothing when the rate is zero", () => {
    expect(
      shouldModerate({
        sampleRate: 0,
        isNewAssessor: false,
        moderateAllForNewAssessors: false,
        random: 0,
      }).moderate,
    ).toBe(false);
  });
});

describe("assessor decisions", () => {
  async function awaitingDecision() {
    const { assessmentId, items } = await publishedQuiz({
      purpose: "summative",
    });
    const result = await submitQuiz(learner, {
      assessmentId,
      responses: { [items[0].id]: [items[0].options![0].id] },
    });
    return result.submissionId;
  }

  it("records a decision and routes a summative one to moderation", async () => {
    const submissionId = await awaitingDecision();

    const { decision, moderation } = await recordAssessorDecision(
      assessorA,
      { submissionId, outcome: "competent", comments: "Meets the standard." },
      { random: 0.99 },
    );

    expect(decision.outcome).toBe("competent");
    expect(moderation.moderate).toBe(true);
    expect(moderation.reason).toBe("full_moderation");
  });

  /** Rule 1: nobody assesses their own work. */
  it("refuses to let someone assess their own submission", async () => {
    const { assessmentId, items } = await publishedQuiz({
      purpose: "summative",
    });

    // The assessor takes the quiz themselves.
    const selfAssessor = sessionFor(
      ["assessor", "learner"],
      assessorA.userId,
    );
    const result = await submitQuiz(selfAssessor, {
      assessmentId,
      responses: { [items[0].id]: [items[0].options![0].id] },
    });

    await expect(
      recordAssessorDecision(selfAssessor, {
        submissionId: result.submissionId,
        outcome: "competent",
      }),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("stops a learner recording a decision", async () => {
    const submissionId = await awaitingDecision();
    await expect(
      recordAssessorDecision(learner, { submissionId, outcome: "competent" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("shows waiting submissions in the assessor queue", async () => {
    await awaitingDecision();
    const queue = await listAssessorQueue(assessorA);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0].learnerFirstName).toBeTruthy();
  });

  it("takes a submission out of the queue once decided", async () => {
    const submissionId = await awaitingDecision();
    await recordAssessorDecision(
      assessorA,
      { submissionId, outcome: "competent" },
      { random: 0.99 },
    );

    const queue = await listAssessorQueue(assessorA);
    expect(queue.map((row) => row.submissionId)).not.toContain(submissionId);
  });

  it("records the decision and its sampling reason in the audit log", async () => {
    const submissionId = await awaitingDecision();
    const { decision } = await recordAssessorDecision(
      assessorA,
      { submissionId, outcome: "not_yet_competent", comments: "Needs more." },
      { random: 0.99 },
    );

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, decision.id)),
    );

    expect(entries[0].action).toBe("assessment.decided");
    expect(entries[0].after).toMatchObject({ routedToModeration: true });
  });
});

describe("moderation", () => {
  async function decidedSubmission() {
    const { assessmentId, items } = await publishedQuiz({
      purpose: "summative",
    });
    const submitted = await submitQuiz(learner, {
      assessmentId,
      responses: { [items[0].id]: [items[0].options![0].id] },
    });
    const { decision } = await recordAssessorDecision(
      assessorA,
      { submissionId: submitted.submissionId, outcome: "competent" },
      { random: 0.99 },
    );
    return { submissionId: submitted.submissionId, decisionId: decision.id };
  }

  /** Rule 2, the one an accreditation reviewer will ask about first. */
  it("refuses to let the assessor moderate their own decision", async () => {
    const { decisionId } = await decidedSubmission();

    const assessorWhoModerates = sessionFor(
      ["assessor", "moderator"],
      assessorA.userId,
    );

    await expect(
      recordModeration(assessorWhoModerates, {
        decisionId,
        outcome: "endorsed",
      }),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("is refused by the database as well as the application", async () => {
    const { decisionId } = await decidedSubmission();

    // Bypassing the application check entirely, as a faulty migration or a
    // future code path might. The database trigger must still refuse.
    let raised: unknown;
    try {
      await withPlatformScope(
        "verifying the segregation trigger",
        async (tx) => {
          const [decision] = await tx
            .select({ assessorId: assessmentDecisions.assessorId })
            .from(assessmentDecisions)
            .where(eq(assessmentDecisions.id, decisionId));

          return tx.insert(moderationRecordsTable).values({
            organisationId,
            decisionId,
            moderatorId: decision.assessorId,
            outcome: "endorsed",
            samplingReason: "direct insert",
          });
        },
      );
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeDefined();

    // Drizzle wraps the driver error, so the trigger's own message is on the
    // cause. Asserting on it proves the refusal came from the segregation
    // trigger and not from some unrelated constraint.
    const cause = (raised as { cause?: { message?: string } }).cause;
    expect(cause?.message).toMatch(/Segregation of duties/i);
  });

  it("lets a different person moderate", async () => {
    const { decisionId, submissionId } = await decidedSubmission();

    const record = await recordModeration(moderator, {
      decisionId,
      outcome: "endorsed",
      comments: "Consistent with the criteria.",
    });

    expect(record.outcome).toBe("endorsed");

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentSubmissions)
        .where(eq(assessmentSubmissions.id, submissionId)),
    );
    expect(row.status).toBe("moderated");
  });

  it("removes the decision from the moderation queue once actioned", async () => {
    const { decisionId } = await decidedSubmission();
    await recordModeration(moderator, { decisionId, outcome: "endorsed" });

    const queue = await listModerationQueue(moderator);
    expect(queue.map((row) => row.decisionId)).not.toContain(decisionId);
  });

  it("refuses to moderate the same decision twice", async () => {
    const { decisionId } = await decidedSubmission();
    await recordModeration(moderator, { decisionId, outcome: "endorsed" });

    await expect(
      recordModeration(moderator, { decisionId, outcome: "endorsed" }),
    ).rejects.toMatchObject({ code: "already_decided" });
  });

  it("requires a replacement outcome when overriding", async () => {
    const { decisionId } = await decidedSubmission();
    await expect(
      recordModeration(moderator, { decisionId, outcome: "overridden" }),
    ).rejects.toBeInstanceOf(AssessmentError);
  });

  it("reopens the submission when a decision is referred back", async () => {
    const { decisionId, submissionId } = await decidedSubmission();

    await recordModeration(moderator, {
      decisionId,
      outcome: "referred_back",
      comments: "Evidence does not support the judgement.",
    });

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentSubmissions)
        .where(eq(assessmentSubmissions.id, submissionId)),
    );
    expect(row.status).toBe("referred_back");
  });

  it("stops an assessor moderating at all without the role", async () => {
    const { decisionId } = await decidedSubmission();
    await expect(
      recordModeration(assessorB, { decisionId, outcome: "endorsed" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("the outcome that stands", () => {
  async function decided(outcome: "competent" | "not_yet_competent") {
    const { assessmentId, items } = await publishedQuiz({
      purpose: "summative",
    });
    const submitted = await submitQuiz(learner, {
      assessmentId,
      responses: { [items[0].id]: [items[0].options![0].id] },
    });
    const { decision } = await recordAssessorDecision(
      assessorA,
      { submissionId: submitted.submissionId, outcome },
      { random: 0.99 },
    );
    return { submissionId: submitted.submissionId, decisionId: decision.id };
  }

  it("is the assessor's decision when it was endorsed", async () => {
    const { submissionId, decisionId } = await decided("competent");
    await recordModeration(moderator, { decisionId, outcome: "endorsed" });

    expect(await effectiveOutcome(admin, submissionId)).toEqual({
      outcome: "competent",
      moderated: true,
      overridden: false,
    });
  });

  /**
   * Reading the assessor's decision directly would report the original result
   * for a submission a moderator overturned. That is the sort of error that
   * shows up as an inexplicable discrepancy at an external audit.
   */
  it("is the moderator's revision when the decision was overridden", async () => {
    const { submissionId, decisionId } = await decided("competent");

    await recordModeration(moderator, {
      decisionId,
      outcome: "overridden",
      revisedOutcome: "not_yet_competent",
      comments: "Evidence does not meet IAC-02.",
    });

    expect(await effectiveOutcome(admin, submissionId)).toEqual({
      outcome: "not_yet_competent",
      moderated: true,
      overridden: true,
    });
  });

  it("reports nothing for a submission nobody has decided", async () => {
    const { assessmentId } = await publishedQuiz({ purpose: "summative" });
    const submitted = await submitQuiz(learner, {
      assessmentId,
      responses: {},
    });

    expect(await effectiveOutcome(admin, submitted.submissionId)).toEqual({
      outcome: null,
      moderated: false,
      overridden: false,
    });
  });
});

// Imported late so the direct-insert test can bypass the library helper.
import { moderationRecords as moderationRecordsTable } from "@/db/schema";

