/**
 * Statutory reporting: identity validation, the NLRD dataset, and WSP/ATR.
 *
 * The validation is the point. A return rejected for a mistyped identity
 * number or a missing equity code costs a provider a full cycle, and the fault
 * is invisible in a spreadsheet until the regulator finds it. Every check that
 * would prevent a rejection is tested here.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  competencies,
  competencyFrameworks,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  addLesson,
  addSection,
  createCourse,
  createQualification,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import {
  enrolUser,
  getEnrolmentForDelivery,
  markLessonComplete,
} from "@/lib/enrolment";
import {
  buildNlrdDataset,
  buildWspAtr,
  nlrdCsv,
  wspAtrCsv,
} from "@/lib/statutory";
import {
  luhnCheckDigit,
  luhnIsValid,
  validateSouthAfricanId,
} from "@/lib/south-african-id";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";
import { referencePrefix } from "@/lib/platform";

/** Confirmed valid by the checksum; the well-known SAQA test value. */
const VALID_ID = "8001015009087";

let organisationId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;
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

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

async function createPerson(
  email: string,
  roles: Role[],
  extra: Partial<typeof users.$inferInsert> = {},
) {
  return withPlatformScope("statutory test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email,
        firstName: email.split("@")[0],
        lastName: "Tester",
        status: "active",
        ...extra,
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

beforeAll(async () => {
  const slug = `stat-${Date.now()}`;

  const created = await withPlatformScope(
    "statutory test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Statutory Test Co",
          status: "active",
          accreditationNumber: "QCTO/SDP/2026/0001",
          wardCode: "79800001",
          qualityAssurancePartner: "MQA",
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
          code: "STA-01",
          name: "Statutory capability",
        })
        .returning({ id: competencies.id });

      return { organisationId: organisation.id, competencyId: competency.id };
    },
  );

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  admin = sessionFor(
    ["tenant_admin"],
    await createPerson("admin@stat.test", ["tenant_admin"], {
      nationalId: VALID_ID,
      equityCode: "AF",
      disabilityCode: "N",
      gender: "male",
      ofoCode: "2026-134101",
      jobTitle: "Centre Manager",
    }),
  );

  learner = sessionFor(
    ["learner"],
    await createPerson("learner@stat.test", ["learner"], {
      nationalId: VALID_ID,
      equityCode: "AF",
      disabilityCode: "N",
      gender: "male",
      ofoCode: "2026-811201",
      jobTitle: "Plant Operator",
    }),
  );
});

afterAll(async () => {
  await withPlatformScope("statutory test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("South African identity numbers", () => {
  it("accepts a valid number", () => {
    const result = validateSouthAfricanId(VALID_ID);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.gender).toBe("male");
    expect(result.citizen).toBe(true);
    expect(result.dateOfBirth.toISOString().slice(0, 10)).toBe("1980-01-01");
  });

  it("reads a female sequence correctly", () => {
    const prefix = "920415012308";
    const id = `${prefix}${luhnCheckDigit(prefix)}`;
    const result = validateSouthAfricanId(id);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.gender).toBe("female");
  });

  it("tolerates spaces and hyphens", () => {
    expect(validateSouthAfricanId("800101 5009 087").valid).toBe(true);
    expect(validateSouthAfricanId("800101-5009-087").valid).toBe(true);
  });

  /** The check digit is what catches a transcription error. */
  it("rejects a mistyped number", () => {
    const wrong = VALID_ID.slice(0, 12) + ((Number(VALID_ID[12]) + 1) % 10);
    const result = validateSouthAfricanId(wrong);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("check digit");
  });

  it("rejects transposed digits", () => {
    const transposed = "8001015009807";
    expect(validateSouthAfricanId(transposed).valid).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(validateSouthAfricanId("80010150090").valid).toBe(false);
    expect(validateSouthAfricanId("80010150090871").valid).toBe(false);
    expect(validateSouthAfricanId("").valid).toBe(false);
  });

  it("rejects anything that is not digits", () => {
    expect(validateSouthAfricanId("80010150090AB").valid).toBe(false);
  });

  it("rejects an impossible date", () => {
    const prefix = "800230500908";
    const id = `${prefix}${luhnCheckDigit(prefix)}`;
    const result = validateSouthAfricanId(id);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("real date");
  });

  it("rejects an impossible month", () => {
    const prefix = "801301500908";
    const id = `${prefix}${luhnCheckDigit(prefix)}`;
    expect(validateSouthAfricanId(id).valid).toBe(false);
  });

  it("rejects an invalid citizenship digit", () => {
    const prefix = "800101500958";
    const id = `${prefix}${luhnCheckDigit(prefix)}`;
    const result = validateSouthAfricanId(id);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain("citizenship");
  });

  /**
   * A two-digit year that would place the birth in the future belongs to the
   * previous century. Without this, "01" starts meaning 2001 correctly today
   * but "99" would mean 2099.
   */
  it("resolves the century so nobody is born in the future", () => {
    const prefix = "990101500908";
    const id = `${prefix}${luhnCheckDigit(prefix)}`;
    const result = validateSouthAfricanId(id, new Date("2026-08-11"));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.dateOfBirth.getUTCFullYear()).toBe(1999);
  });

  it("reads a birth date this century correctly", () => {
    const prefix = "010203400008";
    const id = `${prefix}${luhnCheckDigit(prefix)}`;
    const result = validateSouthAfricanId(id, new Date("2026-08-11"));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.dateOfBirth.getUTCFullYear()).toBe(2001);
  });

  it("computes a check digit consistent with its own validator", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const prefix = Array.from({ length: 12 }, () =>
        Math.floor(Math.random() * 10),
      ).join("");
      expect(luhnIsValid(`${prefix}${luhnCheckDigit(prefix)}`)).toBe(true);
    }
  });
});

describe("permissions", () => {
  it("stops a learner building a statutory return", async () => {
    await expect(buildNlrdDataset(learner)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(buildWspAtr(learner)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});

describe("the NLRD dataset", () => {
  it("includes the provider record from the tenant", async () => {
    const dataset = await buildNlrdDataset(admin);

    expect(dataset.provider.accreditationNumber).toBe("QCTO/SDP/2026/0001");
    expect(dataset.provider.wardCode).toBe("79800001");
    expect(dataset.provider.qualityAssurancePartner).toBe("MQA");
  });

  it("includes a person record for each active learner", async () => {
    const dataset = await buildNlrdDataset(admin);
    expect(dataset.people.length).toBeGreaterThanOrEqual(2);
    expect(dataset.people[0].nationalId).toBe(VALID_ID);
  });

  it("is submittable when the data is complete", async () => {
    const dataset = await buildNlrdDataset(admin);
    expect(dataset.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(dataset.submittable).toBe(true);
  });

  /** The whole reason for validating before submission rather than after. */
  it("blocks submission for a missing identity number, and names the person", async () => {
    await createPerson(`noid-${suffix()}@stat.test`, ["learner"], {
      firstName: "Nomsa",
      lastName: "Missing",
      equityCode: "AF",
      disabilityCode: "N",
    });

    const dataset = await buildNlrdDataset(admin);
    const issue = dataset.issues.find(
      (i) => i.field === "national ID" && i.subject.includes("Missing"),
    );

    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("blocking");
    expect(dataset.submittable).toBe(false);
  });

  it("blocks submission for a mistyped identity number", async () => {
    const wrong = VALID_ID.slice(0, 12) + ((Number(VALID_ID[12]) + 1) % 10);
    await createPerson(`badid-${suffix()}@stat.test`, ["learner"], {
      firstName: "Piet",
      lastName: "Mistyped",
      nationalId: wrong,
      equityCode: "AF",
      disabilityCode: "N",
    });

    const dataset = await buildNlrdDataset(admin);
    const issue = dataset.issues.find((i) => i.subject.includes("Mistyped"));

    expect(issue?.severity).toBe("blocking");
    expect(issue?.message).toContain("check digit");
  });

  /** Missing equity data is flagged but does not stop the return. */
  it("warns without blocking for a missing equity code", async () => {
    await createPerson(`noequity-${suffix()}@stat.test`, ["learner"], {
      firstName: "Thabo",
      lastName: "Noequity",
      nationalId: VALID_ID,
      disabilityCode: "N",
    });

    const dataset = await buildNlrdDataset(admin);
    const issue = dataset.issues.find(
      (i) => i.field === "equity code" && i.subject.includes("Noequity"),
    );

    expect(issue?.severity).toBe("warning");
  });

  it("reports every problem rather than stopping at the first", async () => {
    await createPerson(`multi-${suffix()}@stat.test`, ["learner"], {
      firstName: "Many",
      lastName: "Problems",
    });

    const dataset = await buildNlrdDataset(admin);
    const theirs = dataset.issues.filter((i) => i.subject.includes("Problems"));

    // Missing identity number, equity code and disability code.
    expect(theirs.length).toBeGreaterThanOrEqual(3);
  });

  it("produces the four NLRD files as CSV", async () => {
    const dataset = await buildNlrdDataset(admin);
    const files = nlrdCsv(dataset);

    expect(Object.keys(files).sort()).toEqual([
      "achievement-record-29",
      "enrolment-record-28",
      "person-record-27",
      "provider-record-30",
    ]);
    expect(files["provider-record-30"]).toContain("QCTO/SDP/2026/0001");
    expect(files["person-record-27"]).toContain("National ID");
  });
});

describe("what belongs in the return", () => {
  /** A published, non-accredited course: real training, but not NLRD business. */
  async function internalCourse() {
    const course = await createCourse(admin, { title: `Internal ${suffix()}` });
    const section = await addSection(admin, {
      courseId: course.id,
      title: "Section",
    });
    await addLesson(admin, { sectionId: section.id, title: "Lesson" });
    await tagCourseCompetency(admin, course.id, competencyId);
    const published = await publishCourse(admin, course.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));
    return course.id;
  }

  /** A published course delivering an accredited curriculum module. */
  async function accreditedCourse(options: { saqaId?: string } = {}) {
    const qualification = await createQualification(admin, {
      title: `Occupational Certificate ${suffix()}`,
      curriculumCode: `QC-${suffix()}`,
      saqaId: options.saqaId,
      nqfLevel: 4,
      totalCredits: 120,
    });

    const curriculumModule = await addCurriculumModule(admin, {
      qualificationId: qualification.id,
      component: "knowledge",
      code: `KM-${suffix()}`,
      title: "Knowledge module",
      credits: 12,
    });

    const criterion = await addAssessmentCriterion(admin, {
      curriculumModuleId: curriculumModule.id,
      code: "IAC-01",
      description: "Demonstrates the required knowledge.",
    });

    const course = await createCourse(admin, {
      title: `Accredited course ${suffix()}`,
      curriculumModuleId: curriculumModule.id,
    });
    const section = await addSection(admin, {
      courseId: course.id,
      title: "Section",
    });
    await addLesson(admin, {
      sectionId: section.id,
      title: "Lesson",
      criterionIds: [criterion.id],
    });
    await tagCourseCompetency(admin, course.id, competencyId);
    const published = await publishCourse(admin, course.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));

    return course.id;
  }

  async function complete(courseId: string) {
    const enrolment = await enrolUser(admin, {
      userId: learner.userId,
      courseId,
    });
    const delivery = await getEnrolmentForDelivery(learner, enrolment.id);
    for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
      await markLessonComplete(learner, enrolment.id, lesson.id);
    }
  }

  it("excludes internal training that belongs to no qualification", async () => {
    await complete(await internalCourse());
    const dataset = await buildNlrdDataset(admin);

    // Real training for the client, but the NLRD records national
    // qualifications, so it must not appear in the return.
    expect(dataset.enrolments.every((row) => row.qualificationTitle)).toBe(true);
    expect(dataset.achievements.every((row) => row.moduleCode)).toBe(true);
  });

  it("includes an accredited completion as an achievement, with its module and credits", async () => {
    const courseId = await accreditedCourse({ saqaId: "118742" });
    await complete(courseId);

    const dataset = await buildNlrdDataset(admin);
    const achievement = dataset.achievements.find((row) =>
      row.moduleCode?.startsWith("KM-"),
    );

    expect(achievement).toBeDefined();
    expect(achievement!.credits).toBe(12);
    expect(achievement!.result).toBe("competent");
    expect(achievement!.verificationReference).toMatch(
      new RegExp(`^${referencePrefix()}-`),
    );
  });

  it("blocks the return when a qualification has no SAQA ID", async () => {
    const courseId = await accreditedCourse();
    await complete(courseId);

    const dataset = await buildNlrdDataset(admin);
    const issue = dataset.issues.find(
      (i) => i.field === "SAQA qualification ID",
    );

    expect(issue?.severity).toBe("blocking");
    expect(dataset.submittable).toBe(false);
  });
});

describe("WSP and ATR", () => {
  it("groups training activity by OFO code", async () => {
    const { rows } = await buildWspAtr(admin);
    const operator = rows.find((row) => row.ofoCode === "2026-811201");

    expect(operator).toBeDefined();
    expect(operator!.headcount).toBeGreaterThanOrEqual(1);
  });

  /** Someone without an OFO code must still appear, not silently drop out. */
  it("includes people who have no OFO code, and names them for correction", async () => {
    await createPerson(`noofo-${suffix()}@stat.test`, ["learner"], {
      firstName: "Unmapped",
      lastName: "Role",
      jobTitle: "Storeman",
      nationalId: VALID_ID,
    });

    const { rows, missingOfoCodes } = await buildWspAtr(admin);

    expect(missingOfoCodes).toContain("Storeman");
    expect(rows.some((row) => row.jobTitle === "Storeman")).toBe(true);
  });

  it("exports as CSV with the SETA column headings", async () => {
    const { rows } = await buildWspAtr(admin);
    const csv = wspAtrCsv(rows);

    expect(csv).toContain("OFO code");
    expect(csv).toContain("Headcount");
    expect(csv).toContain("Certificates issued");
  });
});
