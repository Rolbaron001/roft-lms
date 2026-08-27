/**
 * Course and curriculum authoring, against a live database.
 *
 * The publish gate gets the most attention here. It is the difference between
 * a platform that records training and one that can defend an accreditation
 * audit, and its failure mode is silent: a course published with a gap looks
 * exactly like one without.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  auditLog,
  competencies,
  competencyFrameworks,
  courses,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  addLesson,
  addSection,
  AuthoringError,
  coverageReport,
  createCourse,
  createNewVersion,
  createQualification,
  listCourses,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import { importCurriculum, type CurriculumFileInput } from "@/lib/curriculum-import";
import { PermissionDeniedError } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";
import { permissionsFor, type Role } from "@/lib/rbac";

let organisationId: string;
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

let author: AuthenticatedSession;
let learner: AuthenticatedSession;

beforeAll(async () => {
  const slug = `authoring-${Date.now()}`;

  const created = await withPlatformScope(
    "authoring test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Authoring Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [user] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: "author@example.test",
          firstName: "Ada",
          lastName: "Author",
          status: "active",
        })
        .returning({ id: users.id });

      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: user.id,
        role: "tenant_admin",
      });

      const [framework] = await tx
        .insert(competencyFrameworks)
        .values({
          organisationId: organisation.id,
          name: "Test Framework",
        })
        .returning({ id: competencyFrameworks.id });

      const [competency] = await tx
        .insert(competencies)
        .values({
          organisationId: organisation.id,
          frameworkId: framework.id,
          code: "TST-01",
          name: "Test competency",
        })
        .returning({ id: competencies.id });

      return {
        organisationId: organisation.id,
        userId: user.id,
        competencyId: competency.id,
      };
    },
  );

  organisationId = created.organisationId;
  competencyId = created.competencyId;
  author = sessionFor(["tenant_admin"], created.userId);
  learner = sessionFor(["learner"], created.userId);
});

afterAll(async () => {
  await withPlatformScope("authoring test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

/** A qualification with one module and two criteria. */
async function buildQualification() {
  const qualification = await createQualification(author, {
    title: `Occupational Certificate ${Math.random().toString(36).slice(2, 8)}`,
    qctoCode: `QC-${Math.random().toString(36).slice(2, 8)}`,
    nqfLevel: 4,
    totalCredits: 120,
  });

  const curriculumModule = await addCurriculumModule(author, {
    qualificationId: qualification.id,
    component: "knowledge",
    code: "KM-01",
    title: "Occupational health and safety principles",
    credits: 12,
  });

  const first = await addAssessmentCriterion(author, {
    curriculumModuleId: curriculumModule.id,
    code: "IAC-01",
    description: "Explains the legal duties of an employer.",
  });

  const second = await addAssessmentCriterion(author, {
    curriculumModuleId: curriculumModule.id,
    code: "IAC-02",
    description: "Identifies hazards in a described workplace.",
  });

  return { qualification, curriculumModule, criteria: [first, second] };
}

describe("permissions on authoring", () => {
  it("stops a learner creating a course", async () => {
    await expect(
      createCourse(learner, { title: "Unauthorised course" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("stops a learner publishing", async () => {
    const course = await createCourse(author, { title: "Some course" });
    await expect(publishCourse(learner, course.id)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("stops a learner creating a qualification", async () => {
    await expect(
      createQualification(learner, { title: "Unauthorised qualification" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

/**
 * A course that answers to a qualification is where two independent, optional
 * links meet: which Curriculum Module it teaches, and which Study Unit it
 * belongs to. Neither implies the other, so nothing stopped the two from
 * naming different parts of the curriculum — a course that claims to teach
 * a module its own study unit does not actually deliver. createCourse now
 * checks the two agree whenever both are given.
 */
describe("a course's module and its study unit have to agree", () => {
  function suffix() {
    return Math.random().toString(36).slice(2, 8);
  }

  function curriculumWithStudyUnit(code: string): CurriculumFileInput {
    return {
      title: `Cross-check ${code}`,
      qctoCode: code,
      modules: [
        {
          component: "knowledge" as const,
          code: `${code}-KM-01`,
          title: "Module the study unit actually delivers",
          topics: [
            {
              code: "KM0101",
              title: "Topic",
              elements: [
                { kind: "knowledge_topic" as const, code: "KT0101", description: "Teach this." },
              ],
              criteria: [{ code: "IAC0101", description: "Criterion." }],
            },
          ],
        },
        {
          component: "knowledge" as const,
          code: `${code}-KM-02`,
          title: "A module from elsewhere in the same qualification",
          topics: [
            {
              code: "KM0201",
              title: "Topic",
              elements: [
                { kind: "knowledge_topic" as const, code: "KT0101", description: "Teach this." },
              ],
              criteria: [{ code: "IAC0101", description: "Criterion." }],
            },
          ],
        },
      ],
      studyUnits: [
        {
          code: "SU1",
          title: "Study Unit 1",
          modules: [`${code}-KM-01`],
        },
      ],
    };
  }

  async function importFixture(code: string) {
    const summary = await importCurriculum(author, curriculumWithStudyUnit(code));

    const { curriculumModules, studyUnits } = await import("@/db/schema");
    return withTenant(organisationId, async (tx) => {
      const modules = await tx
        .select({ id: curriculumModules.id, code: curriculumModules.code })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, summary.qualificationId));
      const [unit] = await tx
        .select({ id: studyUnits.id })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, summary.qualificationId));

      return {
        studyUnitId: unit.id,
        deliveredModuleId: modules.find((m) => m.code === `${code}-KM-01`)!.id,
        otherModuleId: modules.find((m) => m.code === `${code}-KM-02`)!.id,
      };
    });
  }

  it("allows a module the study unit actually delivers", async () => {
    const code = `X${suffix()}`;
    const { studyUnitId, deliveredModuleId } = await importFixture(code);

    const course = await createCourse(author, {
      title: "Agrees with its study unit",
      studyUnitId,
      curriculumModuleId: deliveredModuleId,
    });

    expect(course.studyUnitId).toBe(studyUnitId);
    expect(course.curriculumModuleId).toBe(deliveredModuleId);
  });

  it("refuses a module the study unit does not deliver", async () => {
    const code = `Y${suffix()}`;
    const { studyUnitId, otherModuleId } = await importFixture(code);

    await expect(
      createCourse(author, {
        title: "Disagrees with its study unit",
        studyUnitId,
        curriculumModuleId: otherModuleId,
      }),
    ).rejects.toThrow(/not one of the modules/);

    await expect(
      createCourse(author, {
        title: "Disagrees with its study unit",
        studyUnitId,
        curriculumModuleId: otherModuleId,
      }),
    ).rejects.toThrow(AuthoringError);
  });

  it("does not create the course when the check fails", async () => {
    const code = `Z${suffix()}`;
    const { studyUnitId, otherModuleId } = await importFixture(code);
    const title = `Should not exist ${code}`;

    await expect(
      createCourse(author, { title, studyUnitId, curriculumModuleId: otherModuleId }),
    ).rejects.toThrow(AuthoringError);

    const found = (await listCourses(author)).find((c) => c.title === title);
    expect(found).toBeUndefined();
  });

  it("still allows either link on its own, with nothing to disagree with", async () => {
    const code = `W${suffix()}`;
    const { studyUnitId, deliveredModuleId } = await importFixture(code);

    const moduleOnly = await createCourse(author, {
      title: "Module only",
      curriculumModuleId: deliveredModuleId,
    });
    expect(moduleOnly.studyUnitId).toBeNull();

    const unitOnly = await createCourse(author, {
      title: "Study unit only",
      studyUnitId,
    });
    expect(unitOnly.curriculumModuleId).toBeNull();
  });
});

describe("the publish gate", () => {
  it("refuses a course with no lessons", async () => {
    const course = await createCourse(author, { title: "Empty course" });
    const result = await publishCourse(author, course.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("no lessons");
  });

  /**
   * Section 4.2: every course is tagged to a competency at build time. An
   * untagged course cannot contribute to capability reporting, which is the
   * reason the platform exists.
   */
  it("refuses a course that is not tagged to any competency", async () => {
    const course = await createCourse(author, { title: "Untagged course" });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, { sectionId: section.id, title: "Lesson one" });

    const result = await publishCourse(author, course.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("not tagged to any competency");
  });

  it("publishes a standalone course once it has lessons and a competency", async () => {
    const course = await createCourse(author, { title: "Good standalone" });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, { sectionId: section.id, title: "Lesson one" });
    await tagCourseCompetency(author, course.id, competencyId);

    const result = await publishCourse(author, course.id);
    expect(result.ok).toBe(true);
  });
});

describe("the Learning Material Matrix", () => {
  it("refuses to publish while a criterion has no lesson behind it", async () => {
    const { curriculumModule, criteria } = await buildQualification();

    const course = await createCourse(author, {
      title: "Partially covered course",
      curriculumModuleId: curriculumModule.id,
    });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    // Covers the first criterion only.
    await addLesson(author, {
      sectionId: section.id,
      title: "Employer duties",
      criterionIds: [criteria[0].id],
    });
    await tagCourseCompetency(author, course.id, competencyId);

    const result = await publishCourse(author, course.id);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.uncovered.map((c) => c.code)).toEqual(["IAC-02"]);
    expect(result.reasons.join(" ")).toContain("IAC-02");
  });

  it("names every uncovered criterion, not just the first", async () => {
    const { curriculumModule } = await buildQualification();

    const course = await createCourse(author, {
      title: "Wholly uncovered course",
      curriculumModuleId: curriculumModule.id,
    });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, { sectionId: section.id, title: "Unmapped lesson" });
    await tagCourseCompetency(author, course.id, competencyId);

    const result = await publishCourse(author, course.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.uncovered.map((c) => c.code).sort()).toEqual([
      "IAC-01",
      "IAC-02",
    ]);
  });

  it("publishes once every criterion is covered", async () => {
    const { curriculumModule, criteria } = await buildQualification();

    const course = await createCourse(author, {
      title: "Fully covered course",
      curriculumModuleId: curriculumModule.id,
    });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, {
      sectionId: section.id,
      title: "Employer duties",
      criterionIds: [criteria[0].id],
    });
    await addLesson(author, {
      sectionId: section.id,
      title: "Hazard identification",
      criterionIds: [criteria[1].id],
    });
    await tagCourseCompetency(author, course.id, competencyId);

    const result = await publishCourse(author, course.id);
    expect(result.ok).toBe(true);
    expect(result.report.uncovered).toEqual([]);
  });

  /**
   * Coverage must come from this course's own lessons. If a lesson in an
   * unrelated course could satisfy a criterion, the report would claim
   * coverage that a learner on this course never actually receives.
   */
  it("does not count a lesson from a different course as coverage", async () => {
    const { curriculumModule, criteria } = await buildQualification();

    const other = await createCourse(author, {
      title: "Another course on the same module",
      curriculumModuleId: curriculumModule.id,
    });
    const otherSection = await addSection(author, {
      courseId: other.id,
      title: "Elsewhere",
    });
    await addLesson(author, {
      sectionId: otherSection.id,
      title: "Covers both criteria",
      criterionIds: [criteria[0].id, criteria[1].id],
    });

    const course = await createCourse(author, {
      title: "The course under test",
      curriculumModuleId: curriculumModule.id,
    });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, { sectionId: section.id, title: "Unmapped" });
    await tagCourseCompetency(author, course.id, competencyId);

    const report = await coverageReport(author, course.id);
    expect(report.uncovered).toHaveLength(2);
  });

  it("reports no criteria for a course outside an accredited qualification", async () => {
    const course = await createCourse(author, { title: "Just a course" });
    const report = await coverageReport(author, course.id);

    expect(report.curriculumModuleId).toBeNull();
    expect(report.criteria).toEqual([]);
    expect(report.uncovered).toEqual([]);
  });
});

describe("versioning a published course", () => {
  async function publishedCourse() {
    const course = await createCourse(author, {
      title: `Published ${Math.random().toString(36).slice(2, 8)}`,
    });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, { sectionId: section.id, title: "Lesson one" });
    await tagCourseCompetency(author, course.id, competencyId);
    const result = await publishCourse(author, course.id);
    expect(result.ok).toBe(true);
    return course;
  }

  /**
   * A learner's completion record refers to what they were assessed against.
   * Editing a published course in place would rewrite that after the fact.
   */
  it("refuses to add a lesson to a published course", async () => {
    const course = await publishedCourse();
    const [section] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(courses)
        .where(eq(courses.id, course.id)),
    );
    expect(section.status).toBe("published");

    await expect(
      addSection(author, { courseId: course.id, title: "Sneaky section" }),
    ).rejects.toBeInstanceOf(AuthoringError);
  });

  it("refuses to publish the same course twice", async () => {
    const course = await publishedCourse();
    await expect(publishCourse(author, course.id)).rejects.toBeInstanceOf(
      AuthoringError,
    );
  });

  it("opens a new draft version and leaves the published one alone", async () => {
    const course = await publishedCourse();
    const draft = await createNewVersion(author, course.id);

    expect(draft.version).toBe(2);
    expect(draft.status).toBe("draft");
    expect(draft.supersedesCourseId).toBe(course.id);

    const [original] = await withTenant(organisationId, (tx) =>
      tx.select().from(courses).where(eq(courses.id, course.id)),
    );
    expect(original.status).toBe("published");
    expect(original.version).toBe(1);
  });

  it("carries competency tags into the new version", async () => {
    const course = await publishedCourse();
    const draft = await createNewVersion(author, course.id);

    const report = await coverageReport(author, draft.id);
    expect(report.competencyCount).toBe(1);
  });

  it("refuses a new version of a draft, which can just be edited", async () => {
    const course = await createCourse(author, { title: "Still a draft" });
    await expect(createNewVersion(author, course.id)).rejects.toBeInstanceOf(
      AuthoringError,
    );
  });
});

describe("audit trail", () => {
  it("records who published a course and what it covered", async () => {
    const course = await createCourse(author, { title: "Audited course" });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, { sectionId: section.id, title: "Lesson one" });
    await tagCourseCompetency(author, course.id, competencyId);
    await publishCourse(author, course.id);

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({
          action: auditLog.action,
          actorId: auditLog.actorId,
          after: auditLog.after,
        })
        .from(auditLog)
        .where(eq(auditLog.entityId, course.id)),
    );

    const published = entries.find((e) => e.action === "course.published");
    expect(published).toBeDefined();
    expect(published?.actorId).toBe(author.userId);
    expect(published?.after).toMatchObject({ status: "published" });
  });

  it("leaves no audit entry when publishing is refused", async () => {
    const course = await createCourse(author, { title: "Refused course" });
    await publishCourse(author, course.id);

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, course.id)),
    );

    expect(entries.map((e) => e.action)).not.toContain("course.published");
  });
});

describe("listing", () => {
  it("reports lesson and competency counts per course", async () => {
    const course = await createCourse(author, { title: "Counted course" });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section one",
    });
    await addLesson(author, { sectionId: section.id, title: "One" });
    await addLesson(author, { sectionId: section.id, title: "Two" });
    await tagCourseCompetency(author, course.id, competencyId);

    const listed = (await listCourses(author)).find(
      (row) => row.id === course.id,
    );

    expect(listed?.lessonCount).toBe(2);
    expect(listed?.competencyCount).toBe(1);
  });
});

