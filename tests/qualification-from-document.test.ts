/**
 * Creating a qualification from its curriculum document, against a live
 * database and the real files.
 *
 * The point of the feature is that nobody retypes what page one already says.
 * So the tests assert the actual values from the actual documents — the title
 * as printed, the curriculum code, the NQF level, the credit total — because
 * "it extracted something" is not the claim being made.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  organisations,
  programmeDocuments,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  createQualificationFromDocuments,
  QualificationImportError,
  readQualificationSources,
} from "@/lib/qualification-from-document";
import { programmeReadiness } from "@/lib/programme-readiness";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let author: AuthenticatedSession;
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

function fixture(name: string) {
  return {
    filename: name,
    bytes: new Uint8Array(readFileSync(join(__dirname, "fixtures", name))),
  };
}

beforeAll(async () => {
  const slug = `qfd-${Date.now()}`;

  const created = await withPlatformScope("qfd setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Qualification From Document Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const people = await tx
      .insert(users)
      .values(
        ["author", "learner"].map((name) => ({
          organisationId: organisation.id,
          email: `${name}@qfd.test`,
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
        userId: byEmail.get("author@qfd.test")!,
        role: "tenant_admin" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("learner@qfd.test")!,
        role: "learner" as const,
      },
    ]);

    return { organisationId: organisation.id, ids: Object.fromEntries(byEmail) };
  });

  organisationId = created.organisationId;
  author = sessionFor(["tenant_admin"], created.ids["author@qfd.test"]);
  learner = sessionFor(["learner"], created.ids["learner@qfd.test"]);
});

afterAll(async () => {
  await withPlatformScope("qfd teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("reading the documents", () => {
  it("takes the SAQA ID and the Exit Level Outcomes off the registration", async () => {
    const reading = await readQualificationSources(author, {
      curriculum: fixture("121151-curriculum.pdf"),
      qualification: fixture("121151-qualification.pdf"),
      assessmentSpecification: fixture("121151-assessment-spec.pdf"),
    });

    // The SAQA ID appears in the registration document and nowhere else.
    expect(reading.details.saqaId).toBe("121151");
    expect(reading.details.title).toBe(
      "Advanced Occupational Certificate: Human Resource Management Officer",
    );
    expect(reading.details.qctoCode).toBe("242303-001-00-00");
    expect(reading.details.nqfLevel).toBe(6);
    expect(reading.details.totalCredits).toBe(134);

    expect(reading.exitLevelOutcomes).toHaveLength(5);
    expect(reading.totals.associatedCriteria).toBeGreaterThan(15);
    expect(reading.exitLevelOutcomes[0].description).toContain(
      "workforce architecture",
    );
  });

  it("takes the curriculum out of the curriculum document", async () => {
    const reading = await readQualificationSources(author, {
      curriculum: fixture("121151-curriculum.pdf"),
      qualification: fixture("121151-qualification.pdf"),
    });

    expect(reading.totals.modules).toBe(15);
    expect(reading.totals.criteria).toBeGreaterThan(100);
    expect(reading.supplied).toEqual({
      curriculum: true,
      qualification: true,
      assessmentSpecification: false,
    });
  });

  /**
   * The curriculum document restates the title, level and credits, so a
   * provider who only has that one still gets somewhere — just without the
   * SAQA ID or the outcomes, and the reading has to say so.
   */
  it("works from the curriculum alone, and says what is missing", async () => {
    const reading = await readQualificationSources(author, {
      curriculum: fixture("121150-curriculum.pdf"),
    });

    expect(reading.details.title).toBe(
      "Higher Occupational Certificate: Human Resource Management Administrator",
    );
    expect(reading.details.nqfLevel).toBe(5);
    expect(reading.details.saqaId).toBeNull();
    expect(reading.exitLevelOutcomes).toEqual([]);

    expect(reading.notes.some((n) => /No Qualification Document/.test(n))).toBe(
      true,
    );
    expect(
      reading.notes.some((n) => /No Assessment Specification/.test(n)),
    ).toBe(true);
  });

  it("writes nothing", async () => {
    await readQualificationSources(author, {
      curriculum: fixture("121150-curriculum.pdf"),
      qualification: fixture("121151-qualification.pdf"),
    });

    const rows = await withTenant(organisationId, (tx) =>
      tx.select({ id: qualifications.id }).from(qualifications),
    );

    expect(rows).toEqual([]);
  });

  it("refuses a file that is not a curriculum document", async () => {
    await expect(
      readQualificationSources(author, {
        curriculum: {
          filename: "notes.pdf",
          bytes: new TextEncoder().encode("This is not a PDF at all."),
        },
      }),
    ).rejects.toThrow(QualificationImportError);
  });

  /**
   * The wrong file in the curriculum slot is an easy mistake with three
   * similarly named documents, and it has to be named rather than producing an
   * empty qualification.
   */
  it("says so when the registration is put in the curriculum slot", async () => {
    await expect(
      readQualificationSources(author, {
        curriculum: fixture("121151-qualification.pdf"),
      }),
    ).rejects.toThrow(/No curriculum modules were found/);
  });

  it("refuses somebody who cannot manage qualifications", async () => {
    await expect(
      readQualificationSources(learner, {
        curriculum: fixture("121150-curriculum.pdf"),
      }),
    ).rejects.toThrow();
  });
});

describe("creating it", () => {
  it("writes the qualification, its outcomes, its curriculum, and files all three", async () => {
    const { qualificationId, summary } = await createQualificationFromDocuments(
      author,
      {
        curriculum: fixture("121151-curriculum.pdf"),
        qualification: fixture("121151-qualification.pdf"),
        assessmentSpecification: fixture("121151-assessment-spec.pdf"),
      },
      {
        title:
          "Advanced Occupational Certificate: Human Resource Management Officer",
        qctoCode: "242303-001-00-00",
        saqaId: "121151",
        nqfLevel: 6,
        totalCredits: 134,
      },
    );

    const stored = await withTenant(organisationId, async (tx) => {
      const [qualification] = await tx
        .select()
        .from(qualifications)
        .where(eq(qualifications.id, qualificationId));

      const modules = await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId));

      const documents = await tx
        .select({ kind: programmeDocuments.kind })
        .from(programmeDocuments)
        .where(eq(programmeDocuments.qualificationId, qualificationId));

      return { qualification, modules, documents };
    });

    expect(stored.qualification.saqaId).toBe("121151");
    expect(stored.qualification.nqfLevel).toBe(6);
    expect(stored.modules.length).toBe(15);
    expect(summary.exitLevelOutcomes).toBe(5);
    expect(summary.criteria).toBeGreaterThan(100);

    // All three are kept, not just used and thrown away — and filing them is
    // what satisfies the readiness gate.
    expect(stored.documents.map((d) => d.kind).sort()).toEqual([
      "assessment_specification",
      "curriculum_document",
      "qualification_document",
    ]);
  });

  /**
   * The whole point: a qualification made this way is ready for material
   * without anybody uploading anything else.
   */
  it("leaves the qualification ready for material", async () => {
    const { qualificationId } = await createQualificationFromDocuments(
      author,
      {
        curriculum: fixture("121150-curriculum.pdf"),
        qualification: fixture("121151-qualification.pdf"),
        assessmentSpecification: fixture("121151-assessment-spec.pdf"),
      },
      {
        title: "Higher Occupational Certificate: HRM Administrator",
        qctoCode: "441601-001-00-00",
        nqfLevel: 5,
        totalCredits: 120,
      },
    );

    const readiness = await programmeReadiness(author, qualificationId);

    expect(readiness.documents).toEqual({
      qualification: true,
      curriculum: true,
      assessmentSpecification: true,
    });
    expect(readiness.ready).toBe(true);
  });

  it("carries the criteria through, not just the module shells", async () => {
    const criteria = await withTenant(organisationId, async (tx) => {
      const modules = await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules);

      const all = [];
      for (const entry of modules) {
        const rows = await tx
          .select({ code: assessmentCriteria.code })
          .from(assessmentCriteria)
          .where(eq(assessmentCriteria.curriculumModuleId, entry.id));
        all.push(...rows);
      }
      return all;
    });

    expect(criteria.length).toBeGreaterThan(200);
    expect(criteria.map((c) => c.code)).toContain("IAC0101");
  });

  /**
   * Re-importing replaces a qualification's whole curriculum, and anything
   * tagged to a criterion goes with it. Creating is not the place for that.
   */
  it("refuses when the code already belongs to a qualification", async () => {
    await expect(
      createQualificationFromDocuments(
        author,
        { curriculum: fixture("121150-curriculum.pdf") },
        {
          title: "Higher Occupational Certificate: HRM Administrator",
          qctoCode: "441601-001-00-00",
          nqfLevel: 5,
        },
      ),
    ).rejects.toThrow(/already carries the code/);
  });

  it("reports the clash on the reading, before anybody presses create", async () => {
    const reading = await readQualificationSources(author, {
      curriculum: fixture("121150-curriculum.pdf"),
    });

    expect(reading.existing).not.toBeNull();
    expect(reading.existing?.title).toContain("HRM Administrator");
  });
});
