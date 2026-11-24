/**
 * The programme map of a qualification already built (job sheet D60 stage 4,
 * 24 November 2026): read from the filed documents, and answers saved to them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { organisations, programmeDocuments, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { answerFiled, filedMap } from "@/lib/filed-map";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let qualificationId: string;
let adminId: string;
let otherOrganisation: string;
const ids: Record<string, string> = {};
const admin = (organisation = organisationId): AuthenticatedSession => ({
  sessionId: "0",
  userId: adminId,
  organisationId: organisation,
  email: "admin@filedmap.test",
  firstName: "Admin",
  lastName: "Test",
  roles: ["tenant_admin"] as Role[],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("filed map fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `filedmap-${Date.now()}`, legalName: "Filed Map Ltd", displayName: "Filed Map", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    const [other] = await tx.insert(organisations).values({ slug: `filedmap-other-${Date.now()}`, legalName: "Other Ltd", displayName: "Other", status: "active" }).returning({ id: organisations.id });
    otherOrganisation = other.id;
    const [user] = await tx.insert(users).values({ organisationId, email: "admin@filedmap.test", firstName: "Admin", lastName: "Test", status: "active" }).returning({ id: users.id });
    adminId = user.id;
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role: "tenant_admin" });
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Filed Programme" }).returning({ id: qualifications.id });
    qualificationId = qualification.id;
    for (const [index, code] of ["SU1", "SU2"].entries()) {
      const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code, title: code, sortOrder: index }).returning({ id: studyUnits.id });
      ids[code] = unit.id;
    }
    const file = (kind: string, filename: string, unit: string | null) => ({
      organisationId,
      qualificationId,
      studyUnitId: unit ? ids[unit] : null,
      kind: kind as never,
      title: filename.replace(/\.\w+$/, ""),
      filename,
      storageKey: `test/${filename}`,
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      sha256: filename,
    });
    const rows = await tx
      .insert(programmeDocuments)
      .values([file("workbook", "Workbook Part A.docx", "SU1"), file("workbook_memorandum", "Guide One.docx", "SU1"), file("workbook_memorandum", "Guide Two.docx", "SU1"), file("theory_guide", "Notes.docx", "SU2")])
      .returning({ id: programmeDocuments.id, filename: programmeDocuments.filename });
    for (const row of rows) ids[row.filename] = row.id;
  });
});

afterAll(async () => {
  await withPlatformScope("filed map teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
    await tx.delete(organisations).where(eq(organisations.id, otherOrganisation));
  });
});

describe("a built qualification's programme map", () => {
  it("is read from the filed documents, and asks where a paper has no guide", async () => {
    const map = await filedMap(admin(), qualificationId);
    expect(map.units.map((unit) => unit.code)).toEqual(["SU1", "SU2"]);
    const workbook = map.items.find((item) => item.title === "Workbook Part A");
    expect(workbook?.question).toBe("guide");
    expect(workbook?.choices.map((choice) => choice.title).sort()).toEqual(["Guide One", "Guide Two"]);
  });

  it("saves a chosen guide, a unit and the other units a document covers to the documents", async () => {
    await answerFiled(admin(), qualificationId, { path: ids["Workbook Part A.docx"], field: "guide", value: ids["Guide Two.docx"] });
    await answerFiled(admin(), qualificationId, { path: ids["Notes.docx"], field: "unit", value: "SU1" });
    await answerFiled(admin(), qualificationId, { path: ids["Notes.docx"], field: "also", value: ["SU2"] });
    const map = await filedMap(admin(), qualificationId);
    expect(map.items.find((item) => item.title === "Workbook Part A")?.guide?.title).toBe("Guide Two");
    const notes = map.items.find((item) => item.title === "Notes");
    expect([notes?.unit, notes?.also]).toEqual(["SU1", ["SU2"]]);
  });

  it("cannot change another provider's documents", async () => {
    await answerFiled(admin(otherOrganisation), qualificationId, { path: ids["Notes.docx"], field: "unit", value: "SU2" });
    const [row] = await withTenant(organisationId, (tx) =>
      tx.select({ unit: programmeDocuments.studyUnitId }).from(programmeDocuments).where(eq(programmeDocuments.id, ids["Notes.docx"])),
    );
    expect(row.unit).toBe(ids.SU1);
  });
});
