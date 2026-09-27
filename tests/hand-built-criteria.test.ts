/**
 * Questions built on the platform assess criteria. Job sheet D1, 27 September.
 *
 * Captured papers named their criteria; a question built on the platform could
 * name none from any screen. Since the coverage check of 26 September refuses
 * to publish a study unit's course until every criterion has something
 * assessing it, that left a provider who builds its assessments here with no
 * way to publish. Its assessor was offered no criteria either, because a study
 * unit's assessment has no single module, so nothing reached the criterion
 * ledger. These hold each part of the fix.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  assessmentCriteria,
  courses,
  curriculumModules,
  organisations,
  qualifications,
  studyUnitModules,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import {
  addAssessmentItem,
  createAssessment,
  criteriaToJudge,
  listCourseCriteria,
  listCourseQuestions,
  publishAssessment,
  setItemCriteria,
  submitQuiz,
} from "@/lib/assessment";
import { coverageReport } from "@/lib/authoring";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const people: Record<string, AuthenticatedSession> = {};

function sessionFor(userId: string, roles: Role[]): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "x@example.test",
    firstName: "X",
    lastName: "Y",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `hand-built-${Date.now()}`;
  await withPlatformScope("hand-built fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Own Assessments", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;

    for (const [name, role] of [
      ["author", "tenant_admin"],
      ["assessor", "assessor"],
      ["learner", "learner"],
    ] as [string, Role][]) {
      const [person] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId, userId: person.id, role });
      people[name] = sessionFor(person.id, [role]);
    }

    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId, title: "Occupational Certificate: Tester" })
      .returning({ id: qualifications.id });

    // Two modules in the unit, and one outside it.
    const modules: Record<string, string> = {};
    for (const [code, order] of [["KM-01", 0], ["KM-02", 1], ["KM-03", 2]] as [string, number][]) {
      const [module] = await tx
        .insert(curriculumModules)
        .values({ organisationId, qualificationId: qualification.id, component: "knowledge", code, title: code, sortOrder: order })
        .returning({ id: curriculumModules.id });
      modules[code] = module.id;
    }
    for (const [key, module, code] of [
      ["one", "KM-01", "IAC0101"],
      ["two", "KM-02", "IAC0201"],
      ["outside", "KM-03", "IAC0301"],
    ]) {
      const [criterion] = await tx
        .insert(assessmentCriteria)
        .values({ organisationId, curriculumModuleId: modules[module], code, description: `${code} described` })
        .returning({ id: assessmentCriteria.id });
      ids[key] = criterion.id;
    }

    const [unit] = await tx
      .insert(studyUnits)
      .values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Study unit one" })
      .returning({ id: studyUnits.id });
    await tx.insert(studyUnitModules).values([
      { organisationId, studyUnitId: unit.id, curriculumModuleId: modules["KM-01"] },
      { organisationId, studyUnitId: unit.id, curriculumModuleId: modules["KM-02"] },
    ]);

    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "SU1 Study unit one", studyUnitId: unit.id })
      .returning({ id: courses.id });
    ids.course = course.id;
  });
});

afterAll(async () => {
  await withPlatformScope("hand-built teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("building a question that assesses criteria", () => {
  it("offers the criteria of every module the study unit delivers, and no others", async () => {
    const offered = await listCourseCriteria(people.author, ids.course);
    expect(offered.map((c) => c.code)).toEqual(["IAC0101", "IAC0201"]);
  });

  it("links a question to several criteria, and refuses one from outside the course", async () => {
    const assessment = await createAssessment(people.author, {
      courseId: ids.course,
      title: "SU1 summative",
      purpose: "summative",
      passMark: 50,
    });
    ids.assessment = assessment.id;

    const first = await addAssessmentItem(people.author, {
      assessmentId: assessment.id,
      stem: "Which is right for both?",
      options: ["This", "That"],
      correctIndexes: [0],
      criterionIds: [ids.one, ids.two],
    });
    const second = await addAssessmentItem(people.author, {
      assessmentId: assessment.id,
      stem: "Which is right for the first?",
      options: ["This", "That"],
      correctIndexes: [1],
      criterionIds: [ids.one],
    });
    Object.assign(ids, { first: first.id, second: second.id });
    Object.assign(ids, { firstRight: first.options![0].id, secondWrong: second.options![0].id });

    await expect(
      addAssessmentItem(people.author, {
        assessmentId: assessment.id,
        stem: "Which is right elsewhere?",
        options: ["This", "That"],
        correctIndexes: [0],
        criterionIds: [ids.outside],
      }),
    ).rejects.toThrow(/criteria of the modules this course delivers/);

    const questions = await listCourseQuestions(people.author, ids.course);
    expect(questions.find((q) => q.id === first.id)?.criterionIds.sort()).toEqual([ids.one, ids.two].sort());
  });

  it("counts towards the study unit's coverage", async () => {
    const report = await coverageReport(people.author, ids.course);
    const covered = Object.fromEntries(report.criteria.map((c) => [c.code, c.coveredBy]));
    expect(covered.IAC0101).toEqual(["2 questions"]);
    expect(covered.IAC0201).toEqual(["1 question"]);
  });

  it("can be changed while a draft, and not once published", async () => {
    await setItemCriteria(people.author, ids.second, [ids.one]);
    await publishAssessment(people.author, ids.assessment);
    await expect(setItemCriteria(people.author, ids.second, [ids.two])).rejects.toThrow(/published/);
  });
});

describe("judging it", () => {
  it("asks the assessor about the criteria the questions assess, with what the marks propose", async () => {
    // Right on the shared question, wrong on the one for IAC0101 alone.
    const result = await submitQuiz(people.learner, {
      assessmentId: ids.assessment,
      declarationAccepted: true,
      responses: { [ids.first]: [ids.firstRight], [ids.second]: [ids.secondWrong] },
    });

    const judged = await criteriaToJudge(people.assessor, result.submissionId);
    const byCode = Object.fromEntries(judged.map((c) => [c.code, c]));
    // Named with where they sit (the module here, having no topic), since
    // each module of a unit has its own IAC0101.
    expect(Object.keys(byCode).sort()).toEqual(["KM-01 IAC0101", "KM-02 IAC0201"]);
    // IAC0101: one of two marks, at a pass mark of 50.
    expect(byCode["KM-01 IAC0101"].percentage).toBe(50);
    expect(byCode["KM-01 IAC0101"].proposed).toBe("competent");
    expect(byCode["KM-02 IAC0201"].proposed).toBe("competent");
  });

  it("records the proposal beside the decision, and asks why when the assessor departs from it", () => {
    const form = readFileSync(join(process.cwd(), "app/assess/[id]/decision-form.tsx"), "utf8");
    expect(form).toMatch(/name=\{`proposed:\$\{criterion\.id\}`\}/);
    expect(form).toMatch(/name=\{`note:\$\{criterion\.id\}`\}/);
    const action = readFileSync(join(process.cwd(), "app/assess/actions.ts"), "utf8");
    expect(action).toMatch(/criterionProposed: some\(criterionProposed\)/);
    expect(action).toMatch(/criterionNotes: some\(criterionNotes\)/);
  });
});
