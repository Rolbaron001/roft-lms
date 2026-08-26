/**
 * Building a curriculum in the App, against a live database.
 *
 * The test that carries the item is the last one: a qualification built
 * entirely through these functions — no JSON file, no transcription by hand —
 * satisfies the readiness gate and can have material captured against it. That
 * is the difference between a platform a provider operates and one that needs
 * the person who writes the import files.
 *
 * The rest guard the two ways a curriculum editor does damage: a duplicated
 * code, which makes every reference to it ambiguous, and a deletion that
 * quietly unlinks work somebody spent months producing.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  organisations,
  programmeDocuments,
  userRoles,
  users,
} from "@/db/schema";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  createCourse,
  createQualification,
} from "@/lib/authoring";
import {
  addTopic,
  addTopicElement,
  curriculumForEditing,
  curriculumProblems,
  CurriculumError,
  removeCriterion,
  removeModule,
  updateCriterion,
  updateModule,
  updateTopic,
} from "@/lib/curriculum-editor";
import { createAssessment } from "@/lib/assessment";
import { addPaper, addSection, addSectionItem } from "@/lib/papers";
import { tagItemCriteria } from "@/lib/marking";
import { programmeReadiness } from "@/lib/programme-readiness";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let author: AuthenticatedSession;

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
  const slug = `curr-${Date.now()}`;

  organisationId = await withPlatformScope("curriculum editor setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Curriculum Editor Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  const userId = await withPlatformScope("curriculum editor fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email: "author@curr.test",
        firstName: "Author",
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });
    await tx
      .insert(userRoles)
      .values({ organisationId, userId: user.id, role: "tenant_admin" });
    return user.id;
  });

  author = sessionFor(["tenant_admin"], userId);
});

afterAll(async () => {
  await withPlatformScope("curriculum editor teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function newQualification() {
  return createQualification(author, { title: `Qualification ${suffix()}` });
}

describe("codes are identity", () => {
  it("refuses a second module with the same code", async () => {
    const qualification = await newQualification();
    await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "First",
    });

    await expect(
      addCurriculumModule(author, {
        qualificationId: qualification.id,
        component: "knowledge",
        code: "KM-01",
        title: "Second",
      }),
    ).rejects.toThrow(/already has a module KM-01/);
  });

  it("refuses a second criterion with the same code in one module", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Module",
    });

    await addAssessmentCriterion(author, {
      curriculumModuleId: mod.id,
      code: "IAC0101",
      description: "Define an organisation.",
    });

    await expect(
      addAssessmentCriterion(author, {
        curriculumModuleId: mod.id,
        code: "IAC0101",
        description: "Something else entirely.",
      }),
    ).rejects.toThrow(/already has a criterion IAC0101/);
  });

  it("refuses a second topic with the same code in one module", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Module",
    });

    await addTopic(author, {
      curriculumModuleId: mod.id,
      code: "KM0101",
      title: "First topic",
    });

    await expect(
      addTopic(author, {
        curriculumModuleId: mod.id,
        code: "KM0101",
        title: "Second topic",
      }),
    ).rejects.toThrow(/already has a topic KM0101/);
  });

  it("allows the same code in different modules", async () => {
    const qualification = await newQualification();
    const first = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "First",
    });
    const second = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-02",
      title: "Second",
    });

    // IAC0101 appears in both modules of the real 121150 curriculum.
    await addAssessmentCriterion(author, {
      curriculumModuleId: first.id,
      code: "IAC0101",
      description: "In the first module.",
    });
    await expect(
      addAssessmentCriterion(author, {
        curriculumModuleId: second.id,
        code: "IAC0101",
        description: "In the second module.",
      }),
    ).resolves.toBeDefined();
  });

  it("refuses a code that is not usable as one", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Module",
    });

    await expect(
      addTopic(author, {
        curriculumModuleId: mod.id,
        code: "not a code!",
        title: "Topic",
      }),
    ).rejects.toThrow(CurriculumError);
  });
});

describe("work experience carries no criteria", () => {
  /**
   * A criterion on a work experience module is a requirement nothing can ever
   * satisfy: the module is evidenced by a signed logbook, so the criterion
   * would sit unachieved permanently and hold up every learner.
   */
  it("refuses a criterion on a work experience module", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "workplace",
      code: "WM-01",
      title: "Work experience",
    });

    await expect(
      addAssessmentCriterion(author, {
        curriculumModuleId: mod.id,
        code: "IAC0101",
        description: "Something.",
      }),
    ).rejects.toThrow(/signed logbook/);
  });

  it("refuses a knowledge element inside a work experience module", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "workplace",
      code: "WM-01",
      title: "Work experience",
    });
    const topic = await addTopic(author, {
      curriculumModuleId: mod.id,
      code: "WE0101",
      title: "An experience",
    });

    await expect(
      addTopicElement(author, {
        topicId: topic.id,
        kind: "knowledge_topic",
        code: "KT0101",
        description: "Theory.",
      }),
    ).rejects.toThrow(/work activity|contextual knowledge|supporting evidence/);

    await expect(
      addTopicElement(author, {
        topicId: topic.id,
        kind: "work_activity",
        code: "WA0101",
        description: "Extract data relating to workforce demographics.",
      }),
    ).resolves.toBeDefined();
  });
});

describe("deleting", () => {
  /** The damage a curriculum editor actually does. */
  it("refuses to delete a criterion a question evidences", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Module",
    });
    const criterion = await addAssessmentCriterion(author, {
      curriculumModuleId: mod.id,
      code: "IAC0101",
      description: "Define an organisation.",
    });

    const course = await createCourse(author, { title: `Course ${suffix()}` });
    const assessment = await createAssessment(author, {
      courseId: course.id,
      title: "Workbook 1",
      purpose: "formative",
    });
    const paper = await addPaper(author, {
      assessmentId: assessment.id,
      code: "V1",
    });
    const section = await addSection(author, {
      paperId: paper.id,
      title: "Activity 1.1",
    });
    const item = await addSectionItem(author, {
      sectionId: section.id,
      type: "long_answer",
      stem: "Define an organisation and explain its value chain.",
      markingGuide: "Rubric.",
      points: 10,
    });
    await tagItemCriteria(author, item.id, [criterion.id]);

    await expect(removeCriterion(author, criterion.id)).rejects.toThrow(
      /still in use/,
    );
    await expect(removeCriterion(author, criterion.id)).rejects.toThrow(
      /1 question evidences it/,
    );

    // And the module it sits in is protected by the same fact.
    await expect(removeModule(author, mod.id)).rejects.toThrow(
      /cannot be removed/,
    );
  });

  it("deletes one nothing depends on", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Module",
    });
    const criterion = await addAssessmentCriterion(author, {
      curriculumModuleId: mod.id,
      code: "IAC0199",
      description: "Added by mistake.",
    });

    await expect(removeCriterion(author, criterion.id)).resolves.toBeUndefined();

    const left = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(assessmentCriteria)
        .where(eq(assessmentCriteria.id, criterion.id)),
    );
    expect(left).toHaveLength(0);
  });
});

describe("editing", () => {
  it("renames a module and its criterion", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Wrong title",
    });
    const criterion = await addAssessmentCriterion(author, {
      curriculumModuleId: mod.id,
      code: "IAC0101",
      description: "Typo here.",
    });

    await updateModule(author, mod.id, {
      code: "KM-02",
      title: "Data Management and Interpretation",
      credits: 12,
    });
    await updateCriterion(author, criterion.id, {
      description: "Define terms and concepts associated with data management.",
    });

    const outline = await curriculumForEditing(author, qualification.id);
    expect(outline.modules[0].code).toBe("KM-02");
    expect(outline.modules[0].credits).toBe(12);
    expect(outline.modules[0].criteria[0].description).toContain("data management");
  });

  it("refuses a rename that collides with another code", async () => {
    const qualification = await newQualification();
    await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "First",
    });
    const second = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-02",
      title: "Second",
    });

    await expect(
      updateModule(author, second.id, { code: "KM-01" }),
    ).rejects.toThrow(/already/);
  });
});

describe("what is wrong with it", () => {
  it("reports percentages that do not add up to 100", async () => {
    const qualification = await newQualification();
    const mod = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Module",
    });
    const first = await addTopic(author, {
      curriculumModuleId: mod.id,
      code: "KM0101",
      title: "First",
      weightPercent: 40,
    });
    await addTopic(author, {
      curriculumModuleId: mod.id,
      code: "KM0102",
      title: "Second",
      weightPercent: 40,
    });

    const problems = await curriculumProblems(author, qualification.id);
    expect(
      problems.some((p) => /add up to 80, not 100/.test(p.what)),
    ).toBe(true);

    await updateTopic(author, first.id, { weightPercent: 60 });
    const after = await curriculumProblems(author, qualification.id);
    expect(after.some((p) => /add up to/.test(p.what))).toBe(false);
  });

  it("reports a module with nothing to assess against", async () => {
    const qualification = await newQualification();
    await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "KM-01",
      title: "Module",
    });

    const problems = await curriculumProblems(author, qualification.id);
    expect(
      problems.some((p) => /no assessment criteria/.test(p.what)),
    ).toBe(true);
    expect(problems.some((p) => /has no topics/.test(p.what))).toBe(true);
  });
});

/**
 * The acceptance test for the item. A qualification built entirely in the App
 * — nobody writing a JSON file, nobody transcribing 85 pages by hand — becomes
 * ready for material to be captured against it.
 */
describe("a curriculum built in the App", () => {
  it("satisfies the readiness gate", async () => {
    const qualification = await createQualification(author, {
      title: "Higher Occupational Certificate: HRM Administrator",
      saqaId: "121150",
    });

    // Not ready: no documents, no curriculum.
    const before = await programmeReadiness(author, qualification.id);
    expect(before.ready).toBe(false);
    expect(before.gaps).toHaveLength(4);

    // The three published documents, as a provider would upload them.
    await withTenant(organisationId, async (tx) => {
      for (const kind of [
        "qualification_document",
        "curriculum_document",
        "assessment_specification",
      ] as const) {
        await tx.insert(programmeDocuments).values({
          organisationId,
          qualificationId: qualification.id,
          kind,
          title: kind,
          filename: `${kind}.pdf`,
          storageKey: `key-${suffix()}`,
          mimeType: "application/pdf",
          sizeBytes: 1,
          sha256: "a".repeat(64),
        });
      }
    });

    // Still not ready: the files are held, but nothing has been read out of
    // them. This is the distinction the gate exists to make.
    const withDocuments = await programmeReadiness(author, qualification.id);
    expect(withDocuments.ready).toBe(false);
    expect(withDocuments.gaps[0].what).toContain("not been read into the App");

    // Now build the curriculum by hand, the way a provider would.
    const knowledge = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: "441601-001-00-KM-01",
      title: "Introduction to Organisations and Human Resource Management",
      credits: 4,
    });

    const topic = await addTopic(author, {
      curriculumModuleId: knowledge.id,
      code: "KM0101",
      title: "Introduction to Organisational Management",
      weightPercent: 100,
    });

    await addTopicElement(author, {
      topicId: topic.id,
      kind: "knowledge_topic",
      code: "KT0101",
      description:
        "Definition of an organisation and the generic organisational value chain.",
    });

    await addAssessmentCriterion(author, {
      curriculumModuleId: knowledge.id,
      code: "IAC0101",
      description:
        "Define an organisation and explain the generic organisational value chain.",
    });

    // A work experience module, which carries elements and no criteria.
    const workplace = await addCurriculumModule(author, {
      qualificationId: qualification.id,
      component: "workplace",
      code: "441601-001-00-WM-01",
      title: "HRM Data Collection and Data Management Processes",
      credits: 8,
    });
    const experience = await addTopic(author, {
      curriculumModuleId: workplace.id,
      code: "WE0101",
      title: "Use appropriate information technology to collect HRM data",
    });
    await addTopicElement(author, {
      topicId: experience.id,
      kind: "work_activity",
      code: "WA0101",
      description:
        "Receive coaching on the operation of organisation specific HRM systems.",
    });

    // Ready. Nothing was imported and nothing was transcribed outside the App.
    const after = await programmeReadiness(author, qualification.id);
    expect(after.ready).toBe(true);
    expect(after.gaps).toEqual([]);
    expect(after.curriculum.modules).toBe(2);
    expect(after.curriculum.criteria).toBe(1);

    // And it is internally consistent.
    const problems = await curriculumProblems(author, qualification.id);
    expect(problems).toEqual([]);
  });
});
