/**
 * The third attempt, against a live database.
 *
 * The rule being built: two not-yet-competent results do not fail a learner.
 * The step is held, a programme review is convened with their employer, and
 * only that review can open a third attempt — conducted orally, by somebody
 * other than whoever authorised it.
 *
 * The test that carries the item is the last one: an oral pass moves the
 * learner's criterion ledger exactly as a written pass would. If it did not,
 * the whole route would be theatre — a third attempt that cannot make anybody
 * competent is not a third attempt.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import { createCourse } from "@/lib/authoring";
import {
  createAssessment,
  publishAssessment,
  recordAssessorDecision,
  recordModeration,
} from "@/lib/assessment";
import {
  addPaper,
  addSection,
  addSectionItem,
  publishPaper,
  saveAnswer,
  startAttempt,
  submitAttempt,
  PaperError,
} from "@/lib/papers";
import { tagItemCriteria } from "@/lib/marking";
import {
  ATTEMPTS_BEFORE_REVIEW,
  authoriseReassessment,
  listHeldAndAuthorised,
  oralAssessmentFor,
  reassessmentState,
  ReassessmentError,
  recordOralAssessment,
  startOralAttempt,
} from "@/lib/reassessment";
import { qualificationReadiness } from "@/lib/eisa";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let qualificationId: string;
let moduleId: string;
let criterionId: string;
let moderator: AuthenticatedSession;
let author: AuthenticatedSession;
let facilitator: AuthenticatedSession;
let assessor: AuthenticatedSession;
let otherAssessor: AuthenticatedSession;
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

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

beforeAll(async () => {
  const slug = `reassess-${Date.now()}`;

  const created = await withPlatformScope("reassessment setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Reassessment Test Co",
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

    const [criterion] = await tx
      .insert(assessmentCriteria)
      .values({
        organisationId: organisation.id,
        curriculumModuleId: module.id,
        code: "IAC0101",
        description: "Explain the generic organisational value chain.",
      })
      .returning({ id: assessmentCriteria.id });

    const people = await tx
      .insert(users)
      .values(
        [
          "author",
          "facilitator",
          "assessor",
          "assessor2",
          "moderator",
          "learner",
        ].map((name) => ({
          organisationId: organisation.id,
          email: `${name}@reassess.test`,
          firstName: name,
          lastName: "Tester",
          status: "active" as const,
        })),
      )
      .returning({ id: users.id, email: users.email });

    const byEmail = new Map(people.map((row) => [row.email, row.id]));

    await tx.insert(userRoles).values([
      {
        organisationId: organisation.id,
        userId: byEmail.get("author@reassess.test")!,
        role: "tenant_admin" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("facilitator@reassess.test")!,
        role: "instructor" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("assessor@reassess.test")!,
        role: "assessor" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("assessor2@reassess.test")!,
        role: "assessor" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("moderator@reassess.test")!,
        role: "moderator" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("learner@reassess.test")!,
        role: "learner" as const,
      },
    ]);

    return {
      organisationId: organisation.id,
      qualificationId: qualification.id,
      moduleId: module.id,
      criterionId: criterion.id,
      ids: Object.fromEntries(byEmail),
    };
  });

  organisationId = created.organisationId;
  qualificationId = created.qualificationId;
  moduleId = created.moduleId;
  criterionId = created.criterionId;

  author = sessionFor(["tenant_admin"], created.ids["author@reassess.test"]);
  facilitator = sessionFor(
    ["instructor"],
    created.ids["facilitator@reassess.test"],
  );
  assessor = sessionFor(["assessor"], created.ids["assessor@reassess.test"]);
  otherAssessor = sessionFor(
    ["assessor"],
    created.ids["assessor2@reassess.test"],
  );
  moderator = sessionFor(
    ["moderator"],
    created.ids["moderator@reassess.test"],
  );
  learner = sessionFor(["learner"], created.ids["learner@reassess.test"]);
});

afterAll(async () => {
  await withPlatformScope("reassessment teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

/** A summative with two written papers, so two attempts can be sat. */
async function buildSummative() {
  const course = await createCourse(author, {
    title: `Reassess ${suffix()}`,
    curriculumModuleId: moduleId,
  });
  const assessment = await createAssessment(author, {
    courseId: course.id,
    title: "SU1 Summative",
    purpose: "summative",
    passMark: 60,
  });

  for (const code of ["V1", "V2"]) {
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code,
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Section A",
      markTotal: 10,
    });
    const item = await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: `Question on the value chain (${code})`,
      markingGuide: "Marked against the rubric.",
      points: 10,
    });
    await tagItemCriteria(author, item.id, [criterionId]);

    const published = await publishPaper(author, paper.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));
  }

  await publishAssessment(author, assessment.id);
  return assessment.id;
}

/** Sits one attempt and has it judged not yet competent. */
async function failOnce(assessmentId: string) {
  const sitting = await startAttempt(learner, assessmentId);
  for (const section of sitting.sections) {
    for (const item of section.items) {
      await saveAnswer(learner, {
        submissionId: sitting.submissionId,
        itemId: item.id,
        answerText: "An answer that does not go far enough.",
      });
    }
  }
  await submitAttempt(learner, {
    submissionId: sitting.submissionId,
    declarationAccepted: true,
  });

  await recordAssessorDecision(assessor, {
    submissionId: sitting.submissionId,
    outcome: "not_yet_competent",
    comments: "Did not address the value chain.",
    criterionOutcomes: { [criterionId]: "not_yet_competent" },
  });

  return sitting.submissionId;
}

/** Two failures: the point at which the step is held. */
async function heldLearner() {
  const assessmentId = await buildSummative();
  await failOnce(assessmentId);
  await failOnce(assessmentId);
  return assessmentId;
}

describe("held, not failed", () => {
  it("holds the assessment after a second not-yet-competent result", async () => {
    const assessmentId = await heldLearner();

    const state = await reassessmentState(author, assessmentId, learner.userId);

    expect(state.notYetCompetent).toBe(ATTEMPTS_BEFORE_REVIEW);
    expect(state.held).toBe(true);
    expect(state.authorisation).toBeNull();
  });

  /**
   * The message matters as much as the refusal. "You have used all your
   * attempts" tells somebody their programme is over, and it is not.
   */
  it("tells the learner it is held for review, not that they have failed", async () => {
    const assessmentId = await heldLearner();

    await expect(startAttempt(learner, assessmentId)).rejects.toThrow(
      /held while your progress is reviewed/,
    );
    await expect(startAttempt(learner, assessmentId)).rejects.toThrow(
      PaperError,
    );
  });

  it("does not hold a learner who passed", async () => {
    const assessmentId = await buildSummative();
    const submissionId = await failOnce(assessmentId);

    // A referral back replaces the first decision with a pass.
    await recordAssessorDecision(assessor, {
      submissionId,
      outcome: "competent",
      comments: "On review, the answer does address it.",
      criterionOutcomes: { [criterionId]: "competent" },
    });

    const state = await reassessmentState(author, assessmentId, learner.userId);
    expect(state.held).toBe(false);
  });

  it("shows a held learner to whoever can convene the review", async () => {
    const assessmentId = await heldLearner();

    const waiting = await listHeldAndAuthorised(facilitator);
    const entry = waiting.find(
      (row) =>
        row.assessmentId === assessmentId && row.userId === learner.userId,
    );

    expect(entry?.notYetCompetent).toBe(2);
    expect(entry?.authorisationId).toBeNull();
    expect(entry?.awaitingOral).toBe(false);
  });
});

describe("the programme review", () => {
  it("refuses a review before the second failure", async () => {
    const assessmentId = await buildSummative();
    await failOnce(assessmentId);

    await expect(
      authoriseReassessment(facilitator, {
        assessmentId,
        userId: learner.userId,
        outcome: "oral_reassessment",
        rationale: "Long enough to satisfy the constraint.",
        employerConsulted: false,
      }),
    ).rejects.toThrow(/follows 2 not-yet-competent results/);
  });

  it("refuses to record an employer consultation with nobody named", async () => {
    const assessmentId = await heldLearner();

    await expect(
      authoriseReassessment(facilitator, {
        assessmentId,
        userId: learner.userId,
        outcome: "oral_reassessment",
        rationale: "Discussed with the employer at length.",
        employerConsulted: true,
      }),
    ).rejects.toThrow(/unnamed employer is not evidence/);
  });

  it("records the employer discussion and its outcome", async () => {
    const assessmentId = await heldLearner();

    await authoriseReassessment(facilitator, {
      assessmentId,
      userId: learner.userId,
      outcome: "oral_reassessment",
      rationale:
        "Two written attempts affected by shift patterns; employer confirms exposure was thin.",
      employerConsulted: true,
      employerRepresentative: "T. Mahlangu, HR Manager",
      employerComments: "Will move them off night shift for the next block.",
    });

    const state = await reassessmentState(author, assessmentId, learner.userId);

    expect(state.held).toBe(false);
    expect(state.authorisation?.outcome).toBe("oral_reassessment");
    expect(state.authorisation?.employerRepresentative).toBe(
      "T. Mahlangu, HR Manager",
    );
    expect(state.oralAvailable).toBe(true);
  });

  it("opens nothing when the review decides on further learning", async () => {
    const assessmentId = await heldLearner();

    await authoriseReassessment(facilitator, {
      assessmentId,
      userId: learner.userId,
      outcome: "further_learning",
      rationale: "Back through the knowledge module before any further sitting.",
      employerConsulted: false,
    });

    const state = await reassessmentState(author, assessmentId, learner.userId);
    expect(state.oralAvailable).toBe(false);
  });

  it("refuses a second review on the same assessment", async () => {
    const assessmentId = await heldLearner();
    const review = {
      assessmentId,
      userId: learner.userId,
      outcome: "oral_reassessment" as const,
      rationale: "A rationale long enough to be accepted.",
      employerConsulted: false,
    };

    await authoriseReassessment(facilitator, review);
    await expect(authoriseReassessment(facilitator, review)).rejects.toThrow(
      /already been through a programme review/,
    );
  });
});

describe("the oral attempt", () => {
  async function authorised() {
    const assessmentId = await heldLearner();
    const authorisation = await authoriseReassessment(facilitator, {
      assessmentId,
      userId: learner.userId,
      outcome: "oral_reassessment",
      rationale: "Employer confirms limited exposure; oral attempt agreed.",
      employerConsulted: true,
      employerRepresentative: "T. Mahlangu, HR Manager",
    });
    return { assessmentId, authorisationId: authorisation.id };
  }

  it("cannot be opened by whoever authorised it", async () => {
    const assessmentId = await heldLearner();
    // An assessor who also holds enrolment:manage authorises it themselves.
    const both = sessionFor(["instructor", "assessor"], assessor.userId);

    const authorisation = await authoriseReassessment(both, {
      assessmentId,
      userId: learner.userId,
      outcome: "oral_reassessment",
      rationale: "A rationale long enough to be accepted.",
      employerConsulted: false,
    });

    await expect(
      startOralAttempt(both, authorisation.id),
    ).rejects.toThrow(/somebody else must conduct it/);
  });

  it("cannot be opened on a review that decided otherwise", async () => {
    const assessmentId = await heldLearner();
    const authorisation = await authoriseReassessment(facilitator, {
      assessmentId,
      userId: learner.userId,
      outcome: "withdrawn",
      rationale: "Learner has left the employer.",
      employerConsulted: false,
    });

    await expect(
      startOralAttempt(assessor, authorisation.id),
    ).rejects.toThrow(/not an oral reassessment/);
  });

  it("can only be opened once", async () => {
    const { authorisationId } = await authorised();

    await startOralAttempt(assessor, authorisationId);
    await expect(
      startOralAttempt(assessor, authorisationId),
    ).rejects.toThrow(ReassessmentError);
    await expect(
      startOralAttempt(assessor, authorisationId),
    ).rejects.toThrow(/granted twice/);
  });

  it("is the third attempt, not a separate kind of event", async () => {
    const { authorisationId } = await authorised();

    const submission = await startOralAttempt(assessor, authorisationId);

    expect(submission.attemptNumber).toBe(3);
    expect(submission.status).toBe("submitted");
  });

  /**
   * An oral assessment leaves no evidence of its own. A pass with no record of
   * what was asked is a claim, and it is the first claim a verifier will pull.
   */
  it("refuses a decision until the exchange is written down", async () => {
    const { authorisationId } = await authorised();
    const submission = await startOralAttempt(assessor, authorisationId);

    await expect(
      recordAssessorDecision(assessor, {
        submissionId: submission.id,
        outcome: "competent",
        comments: "Answered well.",
      }),
    ).rejects.toThrow(/what was asked and answered/);
  });

  it("keeps what was asked and answered", async () => {
    const { authorisationId } = await authorised();
    const submission = await startOralAttempt(assessor, authorisationId);

    await recordOralAssessment(assessor, {
      submissionId: submission.id,
      medium: "In person, Rustenburg office",
      witnessName: "P. Ndlovu, Moderator",
      exchanges: [
        {
          criterionId,
          question: "Walk me through the generic organisational value chain.",
          response:
            "Described inbound logistics through to service, with an example.",
          note: "Unprompted example from their own workplace.",
        },
      ],
    });

    const detail = await oralAssessmentFor(author, submission.id);

    expect(detail.record?.exchanges).toHaveLength(1);
    expect(detail.record?.witnessName).toBe("P. Ndlovu, Moderator");
    expect(detail.authorisation.employerRepresentative).toBe(
      "T. Mahlangu, HR Manager",
    );
  });

  /**
   * The one that carries the item. An oral pass has to reach the criterion
   * ledger by the same route as a written one — including moderation, which
   * is what makes a judgement final. If it did not, a third attempt could not
   * make anybody competent and the whole route would be theatre.
   */
  it("moves readiness exactly as a written pass would", async () => {
    const { authorisationId } = await authorised();
    const submission = await startOralAttempt(otherAssessor, authorisationId);

    await recordOralAssessment(otherAssessor, {
      submissionId: submission.id,
      medium: "Video call",
      exchanges: [
        {
          criterionId,
          question: "Explain the value chain and how HRM sits across it.",
          response: "Answered fully, with an example from their own site.",
        },
      ],
    });

    const before = await qualificationReadiness(
      author,
      qualificationId,
      learner.userId,
    );

    const { decision } = await recordAssessorDecision(
      otherAssessor,
      {
        submissionId: submission.id,
        outcome: "competent",
        comments: "Competent on the oral third attempt.",
        criterionOutcomes: { [criterionId]: "competent" },
      },
      { random: 1 },
    );

    // Moderated like any other decision: an unmoderated judgement is not yet
    // a judgement, and the oral attempt gets no exemption from that.
    await recordModeration(moderator, {
      decisionId: decision.id,
      outcome: "endorsed",
      comments: "Oral record checked against the criteria.",
    });

    const after = await qualificationReadiness(
      author,
      qualificationId,
      learner.userId,
    );

    expect(before.achievedCriteria).toBe(0);
    expect(after.achievedCriteria).toBe(1);
  });
});
