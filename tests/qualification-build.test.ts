/**
 * Building a qualification from its folder, and making it live in one act.
 * Roland, 2 October 2026: "Why not automatically build. The LMS must be
 * clever."
 *
 * With SU1's real second workbook and answer guide, filed the way a folder
 * import files them, against a curriculum numbered the way 121151's is on the
 * live site (straight through each module, "242303-001-00-KM-01-IAC10"), with
 * a practical module beside it that has a criterion of the same topic number,
 * so linking must use the topics the workbook names. And one workbook with a
 * multiple-choice question and no answer, which must wait for a person rather
 * than be guessed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentItemCriteria,
  assessmentItems,
  assessmentSections,
  assessmentPapers,
  assessments,
  courseSteps,
  courses,
  organisations,
  studyUnitModules,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { addAssessmentCriterion, addCurriculumModule, createQualification } from "@/lib/authoring";
import { addTopic } from "@/lib/curriculum-editor";
import { uploadProgrammeDocument } from "@/lib/programme-documents";
import { blockersIn, buildQualification, verificationOf, verifyAndPublish } from "@/lib/qualification-build";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;
let unitId: string;
const criterionIds: Record<string, string> = {};

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures", name)));

function wordFile(text: string): Uint8Array {
  const paragraphs = text
    .split(/\n/)
    .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document><w:body>${paragraphs}</w:body></w:document>`),
  });
}

beforeAll(async () => {
  const slug = `qbuild-${Date.now()}`;
  const made = await withPlatformScope("qualification build fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Build Provider", status: "active" })
      .returning({ id: organisations.id });
    const [person] = await tx
      .insert(users)
      .values({ organisationId: organisation.id, email: `admin@${slug}.test`, firstName: "Bu", lastName: "Ild", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: organisation.id, userId: person.id, role: "tenant_admin" });
    return { orgId: organisation.id, userId: person.id };
  });
  organisationId = made.orgId;
  admin = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: made.userId,
    organisationId,
    email: "admin@qbuild.test",
    firstName: "Bu",
    lastName: "Ild",
    roles: ["tenant_admin"] as Role[],
    permissions: permissionsFor({ roles: ["tenant_admin"] as Role[] }),
    mustChangePassword: false,
    aiOn: false,
  };

  qualificationId = (await createQualification(admin, { title: "HRM Officer" })).id;

  // KM01 numbered straight through, as the live site holds it: KM0101 IAC1-2,
  // KM0102 IAC3-4, KM0103 IAC5-10, KM0104 IAC11-13.
  const km = await addCurriculumModule(admin, { qualificationId, component: "knowledge", code: "242303-001-00-KM-01", title: "Organisational architecture" });
  let n = 0;
  for (const [topic, count] of [["KM0101", 2], ["KM0102", 2], ["KM0103", 6], ["KM0104", 3]] as const) {
    const created = await addTopic(admin, { curriculumModuleId: km.id, code: topic, title: topic });
    for (let i = 0; i < count; i++) {
      n += 1;
      const code = `242303-001-00-KM-01-IAC${n}`;
      const criterion = await addAssessmentCriterion(admin, { curriculumModuleId: km.id, topicId: created.id, code, description: code });
      criterionIds[`${topic}/${i + 1}`] = criterion.id;
    }
  }
  // A practical module with its own topic 03: "IAC0301" could mean this too.
  const pm = await addCurriculumModule(admin, { qualificationId, component: "practical", code: "242303-001-00-PM-01", title: "Practical" });
  const pmTopic = await addTopic(admin, { curriculumModuleId: pm.id, code: "PM0103", title: "PM0103" });
  criterionIds["PM0103/1"] = (
    await addAssessmentCriterion(admin, { curriculumModuleId: pm.id, topicId: pmTopic.id, code: "242303-001-00-PM-01-IAC1", description: "practical" })
  ).id;

  for (const kind of ["qualification_document", "curriculum_document", "assessment_specification"]) {
    await uploadProgrammeDocument(admin, { kind: kind as never, title: kind, qualificationId }, { filename: `${kind}.docx`, bytes: wordFile(`The ${kind}.`) });
  }

  const [unit] = await withTenant(organisationId, (tx) =>
    tx.insert(studyUnits).values({ organisationId, qualificationId, code: "SU1", title: "Organisational Architecture" }).returning({ id: studyUnits.id }),
  );
  unitId = unit.id;
  await withTenant(organisationId, (tx) =>
    tx.insert(studyUnitModules).values([
      { organisationId, studyUnitId: unit.id, curriculumModuleId: km.id },
      { organisationId, studyUnitId: unit.id, curriculumModuleId: pm.id },
    ]),
  );

  const file = (filename: string, kind: string, bytes: Uint8Array) =>
    uploadProgrammeDocument(admin, { kind: kind as never, title: filename.replace(/\.docx$/, ""), studyUnitId: unit.id }, { filename, bytes });
  await file("CA 121151 SU1 TG1.docx", "theory_guide", wordFile("Theory guide for SU1."));
  await file("CA 121151 SU1 WB2.docx", "workbook", fixture("121151-su1-wb2.docx"));
  await file("CA 121151 SU1 WB2 AG.docx", "workbook_memorandum", fixture("121151-su1-wb2-ag.docx"));
  await file(
    "CA 121151 SU1 WB3.docx",
    "workbook",
    wordFile("WORKBOOK 3\nActivity 3.1: Multiple Choice Questions (KM0104)\n1. Which is right?\nA. One\nB. Two"),
  );
}, 300_000);

afterAll(async () => {
  await withPlatformScope("qualification build teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("what stops a paper being captured without a person", () => {
  it("is a multiple-choice question with no answer, and nothing else", () => {
    const paper = {
      title: null,
      declaredCriteria: [],
      problems: [],
      notes: [],
      sections: [
        {
          title: "A",
          instruction: null,
          markTotal: null,
          items: [
            { number: "1", type: "multiple_choice" as const, stem: "Which?", options: ["a", "b"], correctIndex: null, points: 1, criterionCodes: [], markingGuide: null, markedBy: "app" as const },
            { number: "2", type: "long_answer" as const, stem: "Explain.", options: [], correctIndex: null, points: 5, criterionCodes: [], markingGuide: null, markedBy: "assessor" as const },
          ],
        },
      ],
    };
    expect(blockersIn(paper)).toEqual(['"Which?" in "A" has no correct answer in the guide.']);
  });
});

describe("building SU1 from what was filed", () => {
  let report: Awaited<ReturnType<typeof buildQualification>>;
  let courseId: string;

  beforeAll(async () => {
    report = await buildQualification(admin, qualificationId);
    courseId = report.units[0].courseId;
  }, 300_000);

  it("captures the real workbook and holds back the one with no answer", () => {
    expect(report.units).toHaveLength(1);
    expect(report.units[0].captured).toBe(1);
    expect(report.waiting.map((w) => w.what).join(" ")).toMatch(/WB3\.docx was read but cannot be captured/);
  });

  it("links every question to the right KM01 criteria, numbered straight through", async () => {
    const tags = await withTenant(organisationId, async (tx) => {
      const [assessment] = await tx.select({ id: assessments.id }).from(assessments).where(eq(assessments.courseId, courseId));
      const papers = await tx.select({ id: assessmentPapers.id }).from(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessment.id));
      const sections = await tx.select({ id: assessmentSections.id }).from(assessmentSections).where(inArray(assessmentSections.paperId, papers.map((p) => p.id)));
      const items = await tx.select({ id: assessmentItems.id }).from(assessmentItems).where(inArray(assessmentItems.sectionId, sections.map((s) => s.id)));
      return tx.select({ criterionId: assessmentItemCriteria.criterionId }).from(assessmentItemCriteria).where(inArray(assessmentItemCriteria.itemId, items.map((i) => i.id)));
    });
    const linked = new Set(tags.map((tag) => tag.criterionId));
    // The workbook covers topics KM0103 (six criteria) and KM0104 (three).
    const expected = [1, 2, 3, 4, 5, 6].map((i) => criterionIds[`KM0103/${i}`]).concat([1, 2, 3].map((i) => criterionIds[`KM0104/${i}`]));
    expect([...linked].sort()).toEqual(expected.sort());
    // Never the practical module's topic 03, which shares the code.
    expect(linked.has(criterionIds["PM0103/1"])).toBe(false);
  });

  it("lays out the steps: the theory guide, then the workbook", async () => {
    const steps = await withTenant(organisationId, (tx) =>
      tx.select({ kind: courseSteps.kind, release: courseSteps.release }).from(courseSteps).where(eq(courseSteps.courseId, courseId)).orderBy(courseSteps.sortOrder),
    );
    expect(steps.map((s) => s.kind)).toEqual(["document", "assessment"]);
    expect(steps[0].release).toBe("open");
  });

  it("keeps it all in draft", async () => {
    const [course] = await withTenant(organisationId, (tx) => tx.select({ status: courses.status }).from(courses).where(eq(courses.id, courseId)));
    expect(course.status).toBe("draft");
  });

  it("will not go live while anything holds it back, and says what", async () => {
    const verification = await verificationOf(admin, qualificationId);
    expect(verification.built).toBe(true);
    expect(verification.ready).toBe(false);
    const blocking = verification.units[0].blocking.map((b) => b.what).join(" ");
    expect(blocking).toMatch(/WB3\.docx is waiting for a person/);
    const result = await verifyAndPublish(admin, qualificationId);
    expect(result.ok).toBe(false);
    const [course] = await withTenant(organisationId, (tx) => tx.select({ status: courses.status }).from(courses).where(eq(courses.id, courseId)));
    expect(course.status).toBe("draft");
  });

  it("built again, fills gaps only and repairs links that were lost", async () => {
    // As papers captured before 2 October were: their questions linked to nothing.
    await withTenant(organisationId, async (tx) => {
      const [assessment] = await tx.select({ id: assessments.id }).from(assessments).where(eq(assessments.courseId, courseId));
      const papers = await tx.select({ id: assessmentPapers.id }).from(assessmentPapers).where(eq(assessmentPapers.assessmentId, assessment.id));
      const sections = await tx.select({ id: assessmentSections.id }).from(assessmentSections).where(inArray(assessmentSections.paperId, papers.map((p) => p.id)));
      const items = await tx.select({ id: assessmentItems.id }).from(assessmentItems).where(inArray(assessmentItems.sectionId, sections.map((s) => s.id)));
      await tx.delete(assessmentItemCriteria).where(inArray(assessmentItemCriteria.itemId, items.map((i) => i.id)));
    });

    const again = await buildQualification(admin, qualificationId);
    expect(again.units[0].captured).toBe(0);
    expect(again.units[0].stepsKept).toBe(true);
    expect(again.units[0].relinked).toBeGreaterThan(0);

    const steps = await withTenant(organisationId, (tx) => tx.select({ id: courseSteps.id }).from(courseSteps).where(and(eq(courseSteps.courseId, courseId))));
    expect(steps).toHaveLength(2);
  }, 300_000);

  it("leaves the study unit itself where it was", async () => {
    const [unit] = await withTenant(organisationId, (tx) => tx.select({ id: studyUnits.id }).from(studyUnits).where(eq(studyUnits.id, unitId)));
    expect(unit.id).toBe(unitId);
  });
});

describe("a study unit with no papers filed", () => {
  it("holds back a unit with knowledge modules, never a workplace-only one", async () => {
    const km = await addCurriculumModule(admin, { qualificationId, component: "knowledge", code: "242303-001-00-KM-02", title: "Second" });
    const wm = await addCurriculumModule(admin, { qualificationId, component: "workplace", code: "242303-001-00-WM-01", title: "Workplace" });
    await withTenant(organisationId, async (tx) => {
      const [su2, su3] = await tx
        .insert(studyUnits)
        .values([
          { organisationId, qualificationId, code: "SU2", title: "No papers", sortOrder: 2 },
          { organisationId, qualificationId, code: "SU3", title: "At work", sortOrder: 3 },
        ])
        .returning({ id: studyUnits.id });
      await tx.insert(studyUnitModules).values([
        { organisationId, studyUnitId: su2.id, curriculumModuleId: km.id },
        { organisationId, studyUnitId: su3.id, curriculumModuleId: wm.id },
      ]);
    });
    await buildQualification(admin, qualificationId);

    const verification = await verificationOf(admin, qualificationId);
    const unit = (code: string) => verification.units.find((u) => u.code === code)!;
    expect(unit("SU2").blocking.map((b) => b.what).join(" ")).toMatch(/SU2 has no workbooks or assessments/);
    expect(unit("SU3").blocking.map((b) => b.what).join(" ")).not.toMatch(/no workbooks or assessments/);
  }, 300_000);
});
