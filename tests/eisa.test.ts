/**
 * EISA readiness, against a live database.
 *
 * The rule these tests exist to protect is one sentence from the qualification
 * document: admission to the EISA requires that all internal assessment
 * criteria for all modules have been achieved. Not most, not a weighted score
 * over some threshold. Every way that could quietly become "nearly" is a way a
 * learner gets sent to an assessment centre and turned away, so each of them
 * has a test.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  competencies,
  competencyFrameworks,
  organisations,
  studyUnits,
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
  enrolUser,
  getEnrolmentForDelivery,
  markLessonComplete,
} from "@/lib/enrolment";
import {
  addAssessmentItem,
  createAssessment,
  publishAssessment,
  recordAssessorDecision,
  recordModeration,
  submitQuiz,
} from "@/lib/assessment";
import {
  cohortReadiness,
  qualificationReadiness,
  resolveComponentWeights,
  resolveTopicWeights,
} from "@/lib/eisa";
import {
  importCurriculum,
  inspectCurriculum,
  type CurriculumFileInput,
} from "@/lib/curriculum-import";
import {
  acceptLogbook,
  coachSignOff,
  createAgreement,
  getLogbook,
  openLogbook,
  setEntryCompleted,
  submitToCoach,
} from "@/lib/workplace";
import { uploadLogbookEvidence } from "@/lib/uploads";
import {
  getStatementOfResults,
  issueStatementOfResults,
  revokeStatementOfResults,
  verifyStatement,
} from "@/lib/statement-of-results";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;
let stranger: AuthenticatedSession;
let assessor: AuthenticatedSession;
let moderator: AuthenticatedSession;
let coach: AuthenticatedSession;
let competencyId: string;

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
  return withPlatformScope("eisa test fixture", async (tx) => {
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

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * A miniature qualification with the shape of a real one: two knowledge
 * topics carrying different weights, and one practical module.
 */
function curriculumFile(code: string): CurriculumFileInput {
  return {
    title: `Test Qualification ${code}`,
    curriculumCode: code,
    totalCredits: 30,
    componentWeights: { knowledge: 60, practical: 40, workplace: 0 },
    modules: [
      {
        component: "knowledge" as const,
        code: `${code}-KM-01`,
        title: "Knowledge module",
        credits: 20,
        topics: [
          {
            code: "KM0101",
            title: "Big topic",
            weightPercent: 75,
            elements: [
              { kind: "knowledge_topic" as const, code: "KT0101", description: "Something to teach." },
            ],
            criteria: [
              { code: "IAC0101", description: "First criterion." },
              { code: "IAC0102", description: "Second criterion." },
            ],
          },
          {
            code: "KM0102",
            title: "Small topic",
            weightPercent: 25,
            elements: [
              { kind: "knowledge_topic" as const, code: "KT0201", description: "Something else to teach." },
            ],
            criteria: [{ code: "IAC0201", description: "Third criterion." }],
          },
        ],
      },
      {
        component: "practical" as const,
        code: `${code}-PM-01`,
        title: "Practical module",
        credits: 10,
        topics: [
          {
            code: "PS0101",
            title: "A skill",
            elements: [
              { kind: "practical_activity" as const, code: "PA0101", description: "Do the thing." },
            ],
            criteria: [{ code: "IAC0301", description: "Fourth criterion." }],
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  const slug = `eisa-${Date.now()}`;

  const created = await withPlatformScope("eisa test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "EISA Test Co",
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
        code: "EISA-01",
        name: "Demonstrated capability",
      })
      .returning({ id: competencies.id });

    return { organisationId: organisation.id, competencyId: competency.id };
  });

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  admin = sessionFor(
    ["tenant_admin"],
    await createPerson("admin@eisa.test", ["tenant_admin"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@eisa.test", ["learner"]),
  );
  stranger = sessionFor(
    ["learner"],
    await createPerson("stranger@eisa.test", ["learner"]),
  );
  assessor = sessionFor(
    ["assessor"],
    await createPerson("assessor@eisa.test", ["assessor"]),
  );
  moderator = sessionFor(
    ["moderator"],
    await createPerson("moderator@eisa.test", ["moderator"]),
  );
  coach = sessionFor(
    ["workplace_coach"],
    await createPerson("coach@eisa.test", ["workplace_coach"]),
  );
});

afterAll(async () => {
  await withPlatformScope("eisa test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

/**
 * Runs a learner through a real assessment and records a decision carrying
 * per-criterion outcomes. The course is deliberately not bound to the
 * curriculum module: this is about the readiness arithmetic, and binding it
 * would drag the publish gate in as well.
 */
async function achieve(
  criterionIds: string[],
  outcomes: ("competent" | "not_yet_competent")[],
  moderate = true,
) {
  const course = await createCourse(admin, { title: `EISA course ${suffix()}` });
  const section = await addSection(admin, { courseId: course.id, title: "S" });
  await addLesson(admin, { sectionId: section.id, title: "L" });
  await tagCourseCompetency(admin, course.id, competencyId);
  const published = await publishCourse(admin, course.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));

  const assessment = await createAssessment(admin, {
    courseId: course.id,
    title: "Assessment",
    purpose: "summative",
  });
  const item = await addAssessmentItem(admin, {
    assessmentId: assessment.id,
    stem: "A question for the learner",
    options: ["Right", "Wrong"],
    correctIndexes: [0],
  });
  await publishAssessment(admin, assessment.id);

  const enrolment = await enrolUser(admin, {
    userId: learner.userId,
    courseId: course.id,
  });
  const delivery = await getEnrolmentForDelivery(learner, enrolment.id);
  for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
    await markLessonComplete(learner, enrolment.id, lesson.id);
  }

  const submission = await submitQuiz(learner, {
    assessmentId: assessment.id,
    enrolmentId: enrolment.id,
    responses: { [item.id]: [item.options![0].id] },
  });

  const criterionOutcomes: Record<string, "competent" | "not_yet_competent"> = {};
  criterionIds.forEach((id, index) => {
    criterionOutcomes[id] = outcomes[index];
  });

  // Every decision by a new assessor is moderated, so the submission sits at
  // "assessed" until a moderator has seen it — and an unmoderated judgement
  // must not count towards readiness. Moderating it here is what production
  // does, and is the only route to a decision the engine will accept.
  const { decision } = await recordAssessorDecision(
    assessor,
    {
      submissionId: submission.submissionId,
      outcome: outcomes.every((o) => o === "competent")
        ? "competent"
        : "not_yet_competent",
      criterionOutcomes,
    },
    { random: 1 },
  );

  if (moderate) {
    await recordModeration(moderator, {
      decisionId: decision.id,
      outcome: "endorsed",
      comments: "Checked against the criteria.",
    });
  }

  return decision;
}

describe("component weights", () => {
  it("prefers what the curriculum document states over the credit split", () => {
    // The HRM Administrator case: the document says 38/35/27 while its credits
    // say 35/35/30. The document wins.
    const { weights, source } = resolveComponentWeights(
      { knowledge: 0.38, practical: 0.35, workplace: 0.27 },
      { knowledge: 42, practical: 42, workplace: 36 },
    );

    expect(source).toBe("document");
    expect(weights.knowledge).toBeCloseTo(0.38, 5);
    expect(weights.workplace).toBeCloseTo(0.27, 5);
  });

  it("falls back to credits when the document states none", () => {
    const { weights, source } = resolveComponentWeights(null, {
      knowledge: 42,
      practical: 42,
      workplace: 36,
    });

    expect(source).toBe("credits");
    expect(weights.knowledge).toBeCloseTo(42 / 120, 5);
  });

  it("falls back to an even split when there are no credits either", () => {
    const { weights, source } = resolveComponentWeights(null, {
      knowledge: 0,
      practical: 0,
      workplace: 0,
    });

    expect(source).toBe("equal");
    expect(weights.practical).toBeCloseTo(1 / 3, 5);
  });
});

describe("topic weights", () => {
  it("uses the stated percentages", () => {
    expect(
      resolveTopicWeights([{ weightPercent: 75 }, { weightPercent: 25 }]),
    ).toEqual([0.75, 0.25]);
  });

  it("splits evenly when the document gives no percentages", () => {
    const weights = resolveTopicWeights([
      { weightPercent: null },
      { weightPercent: null },
      { weightPercent: null },
    ]);
    expect(weights.every((w) => Math.abs(w - 1 / 3) < 1e-9)).toBe(true);
  });

  it("splits evenly rather than mixing stated and invented percentages", () => {
    // Half a module's topics weighted and half not cannot be reconciled
    // against the document, so it is treated as unweighted throughout.
    expect(
      resolveTopicWeights([{ weightPercent: 75 }, { weightPercent: null }]),
    ).toEqual([0.5, 0.5]);
  });
});

describe("checking a curriculum file before importing it", () => {
  it("notices topic percentages that do not add up", () => {
    const file = curriculumFile(`chk-${suffix()}`);
    file.modules[0].topics![0].weightPercent = 60;

    expect(inspectCurriculum(file).join(" ")).toContain("add up to 85");
  });

  it("notices credits that disagree with the qualification total", () => {
    const file = curriculumFile(`chk-${suffix()}`);
    file.totalCredits = 999;

    expect(inspectCurriculum(file).join(" ")).toContain("add up to 30");
  });

  it("notices a topic with nothing to assess", () => {
    const file = curriculumFile(`chk-${suffix()}`);
    file.modules[0].topics![1].criteria = [];

    expect(inspectCurriculum(file).join(" ")).toContain(
      "no internal assessment criteria",
    );
  });
});

describe("readiness", () => {
  it("starts at nothing achieved and nobody eligible", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`rd-${suffix()}`));

    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    expect(readiness.totalCriteria).toBe(4);
    expect(readiness.achievedCriteria).toBe(0);
    expect(readiness.readinessIndex).toBe(0);
    expect(readiness.eisaEligible).toBe(false);
    expect(readiness.outstanding).toHaveLength(4);
    expect(readiness.curriculumComplete).toBe(true);
  });

  it("reads the component weighting from the imported document", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`rd-${suffix()}`));

    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    expect(readiness.weightSource).toBe("document");
    const knowledge = readiness.components.find((c) => c.component === "knowledge");
    expect(knowledge?.weight).toBeCloseTo(0.6, 5);
  });

  it("refuses eligibility while any module has no criteria captured", async () => {
    // The dangerous case: a half-transcribed curriculum. The captured modules
    // are complete, the untranscribed ones cannot be failed, and without the
    // guard everyone reports eligible.
    const file = curriculumFile(`rd-${suffix()}`);
    file.modules.push({
      component: "workplace" as const,
      code: `${file.curriculumCode}-WM-01`,
      title: "Not yet transcribed",
      credits: 10,
      topics: [],
    });

    const imported = await importCurriculum(admin, file);
    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    expect(readiness.curriculumComplete).toBe(false);
    expect(readiness.modulesWithoutCriteria).toContain(`${file.curriculumCode}-WM-01`);
    expect(readiness.eisaEligible).toBe(false);
  });

  it("lets a learner see their own but not somebody else's", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`rd-${suffix()}`));

    await expect(
      qualificationReadiness(learner, imported.qualificationId, learner.userId),
    ).resolves.toBeDefined();

    await expect(
      qualificationReadiness(learner, imported.qualificationId, stranger.userId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("keeps the cohort view away from learners", async () => {
    await expect(cohortReadiness(learner)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

describe("re-importing a curriculum", () => {
  it("replaces the structure rather than duplicating it", async () => {
    const code = `re-${suffix()}`;

    const first = await importCurriculum(admin, curriculumFile(code));
    const second = await importCurriculum(admin, curriculumFile(code));

    expect(second.created).toBe(false);
    expect(second.qualificationId).toBe(first.qualificationId);

    const readiness = await qualificationReadiness(
      admin,
      second.qualificationId,
      learner.userId,
    );

    // Four criteria, not eight.
    expect(readiness.totalCriteria).toBe(4);
  });
});

describe("achieving criteria", () => {
  it("counts achieved criteria and weights the index by topic", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`ach-${suffix()}`));
    const before = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    const km01 = before.components
      .find((c) => c.component === "knowledge")!
      .modules[0];
    const bigTopic = km01.topics.find((t) => t.code === "KM0101")!;

    await achieve(
      bigTopic.criteria.map((c) => c.criterionId),
      bigTopic.criteria.map(() => "competent" as const),
    );

    const after = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    expect(after.achievedCriteria).toBe(2);

    // The big topic is 75% of its module, so finishing it puts the module at
    // 75 — not at 2/3, which is what counting criteria alone would give.
    const knowledgeModule = after.components.find(
      (c) => c.component === "knowledge",
    )!.modules[0];
    expect(knowledgeModule.percent).toBe(75);
    expect(knowledgeModule.complete).toBe(false);
    expect(knowledgeModule.competenceAchievedAt).toBeNull();
  });

  it("does not call a learner eligible until every criterion is achieved", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`ach-${suffix()}`));
    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    const all = readiness.components
      .flatMap((c) => c.modules)
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);

    // All but one.
    await achieve(all.slice(0, -1), all.slice(0, -1).map(() => "competent" as const));

    const nearly = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    expect(nearly.achievedCriteria).toBe(all.length - 1);
    expect(nearly.eisaEligible).toBe(false);
    expect(nearly.outstanding).toHaveLength(1);

    // And the last one.
    await achieve([all[all.length - 1]], ["competent"]);

    const complete = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    expect(complete.achievedCriteria).toBe(all.length);
    expect(complete.readinessIndex).toBe(100);
    expect(complete.eisaEligible).toBe(true);
    expect(complete.outstanding).toHaveLength(0);

    // Every module now carries the date its last criterion was achieved,
    // which is what the Statement of Results has to show.
    for (const finished of complete.components.flatMap((c) => c.modules)) {
      expect(finished.complete).toBe(true);
      expect(finished.competenceAchievedAt).toBeInstanceOf(Date);
    }
  });

  it("ignores a criterion marked not yet competent", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`ach-${suffix()}`));
    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    const criteria = readiness.components
      .flatMap((c) => c.modules)
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);

    await achieve(
      [criteria[0], criteria[1]],
      ["competent", "not_yet_competent"],
    );

    const after = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    expect(after.achievedCriteria).toBe(1);
  });

  it("does not count a decision that is still waiting for a moderator", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`mod-${suffix()}`));
    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    const criteria = readiness.components
      .flatMap((c) => c.modules)
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);

    // Assessed, sampled for moderation, and left there.
    await achieve([criteria[0]], ["competent"], false);

    const after = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    // An unmoderated judgement is not yet a judgement. Counting it would let a
    // learner be declared EISA eligible on evidence no moderator has seen.
    expect(after.achievedCriteria).toBe(0);
  });

  it("shows the learner in the cohort view once they are enrolled on the qualification", async () => {
    const imported = await importCurriculum(admin, curriculumFile(`coh-${suffix()}`));

    const course = await createCourse(admin, { title: `Cohort course ${suffix()}` });
    const section = await addSection(admin, { courseId: course.id, title: "S" });
    await addLesson(admin, { sectionId: section.id, title: "L" });
    await tagCourseCompetency(admin, course.id, competencyId);
    await publishCourse(admin, course.id);

    await enrolUser(admin, {
      userId: learner.userId,
      courseId: course.id,
      qualificationId: imported.qualificationId,
    });

    const rows = await cohortReadiness(admin);
    const row = rows.find(
      (r) =>
        r.qualificationId === imported.qualificationId &&
        r.userId === learner.userId,
    );

    expect(row).toBeDefined();
    expect(row?.totalCriteria).toBe(4);
  });
});

describe("work experience modules", () => {
  /**
   * A qualification with one knowledge module carrying criteria and one work
   * experience module carrying none, which is the shape the curriculum
   * actually publishes.
   */
  function withWorkExperience(code: string): CurriculumFileInput {
    return {
      title: `Qualification with work experience ${code}`,
      curriculumCode: code,
      modules: [
        {
          component: "knowledge",
          code: `${code}-KM-01`,
          title: "Knowledge module",
          credits: 10,
          topics: [
            {
              code: "KM0101",
              title: "A topic",
              elements: [
                { kind: "knowledge_topic", code: "KT0101", description: "Teach this." },
              ],
              criteria: [{ code: "IAC0101", description: "Achieve this." }],
            },
          ],
        },
        {
          component: "workplace",
          code: `${code}-WM-01`,
          title: "Work experience module",
          credits: 10,
          topics: [
            {
              code: "WE0101",
              title: "An experience",
              elements: [
                { kind: "work_activity", code: "WA0101", description: "Do this at work." },
                { kind: "supporting_evidence", code: "SE01", description: "Performance report." },
              ],
              // Deliberately none. The curriculum does not define internal
              // assessment criteria for work experience.
              criteria: [],
            },
          ],
        },
      ],
    };
  }

  async function moduleIdFor(qualificationId: string, component: string) {
    const { curriculumModules } = await import("@/db/schema");
    return withTenant(organisationId, async (tx) => {
      const rows = await tx
        .select({ id: curriculumModules.id, component: curriculumModules.component })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId));
      return rows.find((row) => row.component === component)!.id;
    });
  }

  it("does not treat a criterion-free work experience module as untranscribed", async () => {
    const imported = await importCurriculum(admin, withWorkExperience(`we-${suffix()}`));

    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    // Before this was fixed, the module reported zero criteria and the whole
    // qualification was declared incompletely captured.
    expect(readiness.curriculumComplete).toBe(true);
    expect(readiness.modulesWithoutCriteria).toEqual([]);
  });

  it("marks the work experience module as proved by a logbook, not criteria", async () => {
    const imported = await importCurriculum(admin, withWorkExperience(`we-${suffix()}`));

    const readiness = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    const workplace = readiness.components.find((c) => c.component === "workplace")!;
    expect(workplace.modules[0].route).toBe("logbook");

    const knowledge = readiness.components.find((c) => c.component === "knowledge")!;
    expect(knowledge.modules[0].route).toBe("criteria");
  });

  it("keeps the learner ineligible while the logbook is unsigned, even with every criterion achieved", async () => {
    // This is the failure the fix exists to prevent: counting criteria alone
    // would call this learner ready while their workplace evidence had never
    // been witnessed by anybody.
    const imported = await importCurriculum(admin, withWorkExperience(`we-${suffix()}`));
    const before = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    const criterionIds = before.components
      .flatMap((c) => c.modules)
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);

    await achieve(criterionIds, criterionIds.map(() => "competent" as const));

    const after = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    expect(after.achievedCriteria).toBe(after.totalCriteria);
    expect(after.eisaEligible).toBe(false);

    const blocking = after.outstanding.find((o) => o.criterionCode === "Logbook");
    expect(blocking).toBeDefined();
    expect(blocking?.description).toContain("No work experience logbook");
  });

  it("completes the module when an assessor accepts the logbook", async () => {
    const imported = await importCurriculum(admin, withWorkExperience(`we-${suffix()}`));
    const moduleId = await moduleIdFor(imported.qualificationId, "workplace");

    const agreement = await createAgreement(admin, {
      learnerId: learner.userId,
      coachId: coach.userId,
      employerName: "Acme Mining Services",
    });
    const logbook = await openLogbook(admin, agreement.id, moduleId);

    const view = await getLogbook(learner, logbook.id);
    for (const entry of view.entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }
    const evidenceEntry = view.entries.find((e) => e.code === "SE01")!;
    await uploadLogbookEvidence(learner, evidenceEntry.entryId, [
      { filename: "report.txt", bytes: new TextEncoder().encode("A report.") },
    ]);

    await submitToCoach(learner, logbook.id, 120);

    // Recorded in full, but nobody has witnessed it yet.
    const recorded = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    const pending = recorded.components
      .find((c) => c.component === "workplace")!
      .modules[0];
    expect(pending.percent).toBe(100);
    expect(pending.complete).toBe(false);

    await coachSignOff(coach, logbook.id, { outcome: "signed" });
    await acceptLogbook(assessor, logbook.id);

    const accepted = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    const done = accepted.components
      .find((c) => c.component === "workplace")!
      .modules[0];

    expect(done.complete).toBe(true);
    // The Statement of Results needs a date per module; for work experience it
    // is the date the assessor took receipt.
    expect(done.competenceAchievedAt).toBeInstanceOf(Date);
  });
});

describe("the Statement of Results", () => {
  /**
   * A minimal qualification the learner can actually finish: one knowledge
   * module with one criterion, so the eligible path is reachable in a test.
   */
  function finishable(code: string): CurriculumFileInput {
    return {
      title: `Finishable Qualification ${code}`,
      curriculumCode: code,
      saqaId: `SAQA-${code}`,
      nqfLevel: 5,
      totalCredits: 10,
      assessmentQualityPartner: "SERVICES SETA",
      modules: [
        {
          component: "knowledge",
          code: `${code}-KM-01`,
          title: "The only module",
          credits: 10,
          topics: [
            {
              code: "KM0101",
              title: "A topic",
              elements: [
                { kind: "knowledge_topic", code: "KT0101", description: "Teach." },
              ],
              criteria: [{ code: "IAC0101", description: "Achieve." }],
            },
          ],
        },
      ],
    };
  }

  it("refuses while anything is outstanding, and says what", async () => {
    const imported = await importCurriculum(admin, finishable(`sor-${suffix()}`));

    const result = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The learner is the one who travels to the assessment centre, so the
      // refusal has to name what is missing rather than just decline.
      expect(result.reasons.join(" ")).toContain("outstanding");
      expect(result.reasons.join(" ")).toContain("IAC0101");
    }
  });

  it("refuses while the curriculum is only half transcribed", async () => {
    const file = finishable(`sor-${suffix()}`);
    file.modules.push({
      component: "practical",
      code: `${file.curriculumCode}-PM-01`,
      title: "Not transcribed",
      credits: 10,
      topics: [],
    });

    const imported = await importCurriculum(admin, file);
    const result = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons[0]).toContain("not fully captured");
    }
  });

  it("issues once every criterion is achieved, carrying a date per module", async () => {
    const imported = await importCurriculum(admin, finishable(`sor-${suffix()}`));
    const before = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );

    const criterionIds = before.components
      .flatMap((c) => c.modules)
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);

    await achieve(criterionIds, criterionIds.map(() => "competent" as const));

    const issued = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const statement = await getStatementOfResults(admin, issued.statementId);

    // The qualification document requires the final result and the date
    // competence was achieved, for every module of every component.
    expect(statement.statement.modules).toHaveLength(1);
    expect(statement.statement.modules[0].result).toBe("Competent");
    expect(statement.statement.modules[0].achievedAt).toBeTruthy();

    // And the identifiers an assessment centre checks against their own record.
    expect(statement.statement.qualification.saqaId).toContain("SAQA-");
    expect(statement.statement.qualification.nqfLevel).toBe(5);
    expect(statement.statement.qualification.assessmentQualityPartner).toBe(
      "SERVICES SETA",
    );
  });

  it("refuses a second statement while the first stands", async () => {
    const imported = await importCurriculum(admin, finishable(`sor-${suffix()}`));
    const before = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    const criterionIds = before.components
      .flatMap((c) => c.modules)
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);
    await achieve(criterionIds, criterionIds.map(() => "competent" as const));

    await issueStatementOfResults(admin, imported.qualificationId, learner.userId);

    // Two documents making the same claim must never be in circulation.
    await expect(
      issueStatementOfResults(admin, imported.qualificationId, learner.userId),
    ).rejects.toMatchObject({ code: "already_issued" });
  });

  it("can be checked by reference without signing in, and reports a withdrawal", async () => {
    const imported = await importCurriculum(admin, finishable(`sor-${suffix()}`));
    const before = await qualificationReadiness(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    const criterionIds = before.components
      .flatMap((c) => c.modules)
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);
    await achieve(criterionIds, criterionIds.map(() => "competent" as const));

    const issued = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    if (!issued.ok) throw new Error("expected the statement to issue");

    const checked = await verifyStatement(issued.reference);
    expect(checked).toMatchObject({ found: true, valid: true });
    expect(checked.learnerName).toContain("learner");

    await revokeStatementOfResults(
      admin,
      issued.statementId,
      "Issued against the wrong qualification.",
    );

    // Never deleted: an assessment centre may hold a copy, and the honest
    // answer is "withdrawn, and here is why".
    const after = await verifyStatement(issued.reference);
    expect(after).toMatchObject({ found: true, valid: false });
    expect(after.revokedReason).toContain("wrong qualification");
  });

  it("returns nothing for a reference that does not exist", async () => {
    expect(await verifyStatement("ROFT-AAAAA-AAAAA-AAAAA-AAAAA")).toMatchObject({
      found: false,
      valid: false,
    });
  });

  it("keeps a learner from issuing one to themselves", async () => {
    const imported = await importCurriculum(admin, finishable(`sor-${suffix()}`));
    await expect(
      issueStatementOfResults(learner, imported.qualificationId, learner.userId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  /**
   * Two modules taught as two study units, so a statement for one can be
   * checked against the other. A single-module fixture cannot show the thing
   * that matters, which is the boundary.
   */
  function twoUnits(code: string): CurriculumFileInput {
    return {
      title: `Two Unit Qualification ${code}`,
      curriculumCode: code,
      saqaId: `SAQA-${code}`,
      nqfLevel: 5,
      totalCredits: 20,
      assessmentQualityPartner: "SERVICES SETA",
      modules: [
        {
          component: "knowledge",
          code: `${code}-KM-01`,
          title: "First module",
          credits: 10,
          topics: [
            {
              code: "KM0101",
              title: "A topic",
              elements: [
                { kind: "knowledge_topic", code: "KT0101", description: "Teach." },
              ],
              criteria: [{ code: "IAC0101", description: "Achieve one." }],
            },
          ],
        },
        {
          component: "knowledge",
          code: `${code}-KM-02`,
          title: "Second module",
          credits: 10,
          topics: [
            {
              code: "KM0201",
              title: "Another topic",
              elements: [
                { kind: "knowledge_topic", code: "KT0201", description: "Teach." },
              ],
              criteria: [{ code: "IAC0201", description: "Achieve two." }],
            },
          ],
        },
      ],
      studyUnits: [
        { code: "SU1", title: "First unit", modules: [`${code}-KM-01`] },
        { code: "SU2", title: "Second unit", modules: [`${code}-KM-02`] },
      ],
    };
  }

  async function unitsOf(qualificationId: string) {
    return withTenant(admin.organisationId, (tx) =>
      tx
        .select({ id: studyUnits.id, code: studyUnits.code })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId)),
    );
  }

  async function criteriaFor(qualificationId: string, moduleCode: string) {
    const readiness = await qualificationReadiness(
      admin,
      qualificationId,
      learner.userId,
    );
    return readiness.components
      .flatMap((c) => c.modules)
      .filter((m) => m.code.endsWith(moduleCode))
      .flatMap((m) => m.topics)
      .flatMap((t) => t.criteria)
      .map((c) => c.criterionId);
  }

  /**
   * The point of issuing per study unit: a learner who has finished the first
   * unit gets its statement without waiting for the rest of the qualification.
   */
  it("issues for one study unit while the rest is outstanding", async () => {
    const code = `su-${suffix()}`;
    const imported = await importCurriculum(admin, twoUnits(code));
    const units = await unitsOf(imported.qualificationId);
    const su1 = units.find((u) => u.code === "SU1")!;

    const firstOnly = await criteriaFor(imported.qualificationId, "KM-01");
    await achieve(firstOnly, firstOnly.map(() => "competent" as const));

    // The whole qualification is not finished, so the ordinary statement
    // must still refuse.
    const whole = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    expect(whole.ok).toBe(false);

    const issued = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
      su1.id,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const statement = await getStatementOfResults(admin, issued.statementId);
    expect(statement.statement.studyUnit?.code).toBe("SU1");

    // And it confirms only what that unit delivers. A statement naming the
    // second module would say the learner achieved something nobody assessed.
    expect(statement.statement.modules).toHaveLength(1);
    expect(statement.statement.modules[0].code).toContain("KM-01");
  });

  it("refuses a study unit whose own modules are outstanding", async () => {
    const code = `su-${suffix()}`;
    const imported = await importCurriculum(admin, twoUnits(code));
    const units = await unitsOf(imported.qualificationId);
    const su2 = units.find((u) => u.code === "SU2")!;

    const firstOnly = await criteriaFor(imported.qualificationId, "KM-01");
    await achieve(firstOnly, firstOnly.map(() => "competent" as const));

    const result = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
      su2.id,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("SU2");
  });

  /**
   * The two forms are different documents making different claims, so holding
   * one must not block the other. Holding the same one twice still must.
   */
  it("keeps the unit statement and the qualification statement apart", async () => {
    const code = `su-${suffix()}`;
    const imported = await importCurriculum(admin, twoUnits(code));
    const units = await unitsOf(imported.qualificationId);
    const su1 = units.find((u) => u.code === "SU1")!;
    const su2 = units.find((u) => u.code === "SU2")!;

    const all = [
      ...(await criteriaFor(imported.qualificationId, "KM-01")),
      ...(await criteriaFor(imported.qualificationId, "KM-02")),
    ];
    await achieve(all, all.map(() => "competent" as const));

    const first = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
      su1.id,
    );
    expect(first.ok).toBe(true);

    // A different unit is a different claim.
    const second = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
      su2.id,
    );
    expect(second.ok).toBe(true);

    // So is the whole qualification.
    const whole = await issueStatementOfResults(
      admin,
      imported.qualificationId,
      learner.userId,
    );
    expect(whole.ok).toBe(true);

    // The same claim twice is still refused.
    await expect(
      issueStatementOfResults(
        admin,
        imported.qualificationId,
        learner.userId,
        su1.id,
      ),
    ).rejects.toMatchObject({ code: "already_issued" });
  });

  it("refuses a study unit belonging to another qualification", async () => {
    const mine = await importCurriculum(admin, twoUnits(`su-${suffix()}`));
    const other = await importCurriculum(admin, twoUnits(`su-${suffix()}`));
    const otherUnits = await unitsOf(other.qualificationId);

    await expect(
      issueStatementOfResults(
        admin,
        mine.qualificationId,
        learner.userId,
        otherUnits[0].id,
      ),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });
});
