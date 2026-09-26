/**
 * Reading a provider's alignment matrix, against Curiosa's real one.
 *
 * Job sheet W2, Roland 26 September: the platform reads alignment matrices of
 * this shape, from any provider, to check coverage; and it holds what the
 * provider wants loaded, after they confirm it during the upload.
 *
 * The fixture is Curiosa's own `121151 Alignment Matrix.xlsx`: three sheets,
 * 273 rows, every knowledge criterion mapped to a theory guide chapter, a
 * workbook activity and a summative task, and nine criteria the provider
 * constructed, each citing a design decision. The curriculum is the published
 * 121151 PDF, read through the application's own import path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  criterionAlignment,
  curriculumModules,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import { importAlignmentMatrix, readAlignmentMatrix } from "@/lib/alignment-matrix";
import {
  createQualificationFromDocuments,
  readQualificationSources,
} from "@/lib/qualification-from-document";
import { permissionsFor } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures", name)));
}

beforeAll(async () => {
  const slug = `matrix-${Date.now()}`;
  const made = await withPlatformScope("matrix fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Matrix Provider", status: "active" })
      .returning({ id: organisations.id });
    const [person] = await tx
      .insert(users)
      .values({ organisationId: organisation.id, email: `admin-${slug}@example.test`, firstName: "M", lastName: "Admin", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: organisation.id, userId: person.id, role: "tenant_admin" });
    return { orgId: organisation.id, userId: person.id };
  });

  organisationId = made.orgId;
  admin = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: made.userId,
    organisationId,
    email: "admin@example.test",
    firstName: "M",
    lastName: "Admin",
    roles: ["tenant_admin"],
    permissions: permissionsFor({ roles: ["tenant_admin"] }),
    mustChangePassword: false,
    aiOn: false,
  };

  const documents = {
    qualification: { filename: "121151-qualification.pdf", bytes: fixture("121151-qualification.pdf") },
    curriculum: { filename: "121151-curriculum.pdf", bytes: fixture("121151-curriculum.pdf") },
  };
  const reading = await readQualificationSources(admin, documents);
  const created = await createQualificationFromDocuments(admin, documents, {
    title: reading.details.title ?? "Advanced Occupational Certificate: HRM Officer",
    curriculumCode: reading.details.curriculumCode ?? undefined,
    saqaId: reading.details.saqaId ?? undefined,
    nqfLevel: reading.details.nqfLevel ?? undefined,
    totalCredits: reading.details.totalCredits ?? undefined,
  });
  qualificationId = created.qualificationId;
}, 120_000);

afterAll(async () => {
  await withPlatformScope("matrix teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function criteriaCount(onlyAdded = false) {
  return withTenant(organisationId, async (tx) => {
    const modules = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));
    const rows = await tx
      .select({ id: assessmentCriteria.id })
      .from(assessmentCriteria)
      .where(
        and(
          inArray(assessmentCriteria.curriculumModuleId, modules.map((m) => m.id)),
          onlyAdded ? isNotNull(assessmentCriteria.addedFrom) : undefined,
        ),
      );
    return rows.length;
  });
}

describe("reading Curiosa's 121151 alignment matrix", () => {
  it("reads all three sheets, with each row's module, topic and criteria", () => {
    const reading = readAlignmentMatrix(fixture("121151-alignment-matrix.xlsx"));
    expect(reading.sheets.map((s) => s.sheetName)).toEqual(["Knowledge", "Practical", "Workplace"]);
    const knowledge = reading.sheets[0];
    expect(knowledge.rows).toHaveLength(121);
    expect(knowledge.rows[0].moduleCode).toBe("KM01");
    expect(knowledge.rows[0].topic?.code).toBe("KM0101");
    expect(knowledge.rows[0].criteria[0].code).toBe("IAC0101");
    expect(knowledge.rows[0].resources.map((r) => r.kind)).toEqual([
      "theory_guide",
      "workbook",
      "summative_assessment",
    ]);
    // A practical row names several criteria and its simulation.
    const practical = reading.sheets[1];
    expect(practical.rows[0].criteria.map((c) => c.code)).toEqual(["IAC0101", "IAC0102", "IAC0103", "IAC0104"]);
    expect(practical.rows[0].resources).toContainEqual({
      kind: "summative_assessment",
      reference: "SU1 Simulation PM0101",
    });
  });
});

describe("holding what the provider confirms", () => {
  it("records coverage for what matches, and adds nothing until asked", async () => {
    const before = await criteriaCount();
    const summary = await importAlignmentMatrix(admin, qualificationId, fixture("121151-alignment-matrix.xlsx"));

    expect(summary.added).toBe(0);
    expect(await criteriaCount()).toBe(before);
    expect(summary.criteriaMatched).toBeGreaterThan(150);

    // The nine the provider constructed are offered, each with the reason the
    // matrix gives, and so is the topic they sit in.
    const criteria = summary.proposedAdditions.filter((p) => p.kind === "criterion");
    expect(criteria).toHaveLength(9);
    expect(criteria.every((p) => /DD-00\d/.test(p.reason))).toBe(true);
    expect(summary.proposedAdditions).toContainEqual(
      expect.objectContaining({ kind: "topic", moduleCode: "KM01", code: "KM0107" }),
    );
  });

  it("adds exactly what was ticked, marked as the provider's own, with its coverage", async () => {
    const offered = await importAlignmentMatrix(admin, qualificationId, fixture("121151-alignment-matrix.xlsx"));
    const before = await criteriaCount();

    const confirmed = await importAlignmentMatrix(
      admin,
      qualificationId,
      fixture("121151-alignment-matrix.xlsx"),
      offered.proposedAdditions.map((p) => p.key),
    );

    expect(confirmed.added).toBeGreaterThanOrEqual(9);
    expect(await criteriaCount()).toBe(before + 9);
    expect(await criteriaCount(true)).toBe(9);
    expect(confirmed.proposedAdditions).toHaveLength(0);

    const added = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: assessmentCriteria.id, addedFrom: assessmentCriteria.addedFrom })
        .from(assessmentCriteria)
        .where(isNotNull(assessmentCriteria.addedFrom)),
    );
    expect(added.every((row) => /^Alignment matrix: .*DD-00\d/.test(row.addedFrom!))).toBe(true);

    const covered = await withTenant(organisationId, (tx) =>
      tx
        .select({ criterionId: criterionAlignment.criterionId })
        .from(criterionAlignment)
        .where(inArray(criterionAlignment.criterionId, added.map((row) => row.id))),
    );
    expect(new Set(covered.map((row) => row.criterionId)).size).toBe(9);
  });
});
