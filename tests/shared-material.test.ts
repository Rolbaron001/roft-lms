/**
 * Material and workbooks shared between study units (job sheet D57; Roland,
 * 19 and 23 November 2026; Heidi, 20 November). Read against Heidi's own
 * alignment document for SP-260508, which lists Formative Workbook 1 for SU1
 * and SU2.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { curriculumModules, organisations, programmeDocuments, qualifications, studyUnitModules, studyUnits, userRoles, users } from "@/db/schema";
import { readDocxText } from "@/lib/office";
import { sharedLinksOf } from "@/lib/qualification-build";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let qualificationId: string;
let adminId: string;
const ids: Record<string, string> = {};
const admin = (): AuthenticatedSession => ({
  sessionId: "0",
  userId: adminId,
  organisationId,
  email: "admin@shared.test",
  firstName: "Admin",
  lastName: "Test",
  roles: ["tenant_admin"] as Role[],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false,
  aiOn: false,
});

const alignment = readDocxText(new Uint8Array(readFileSync(join(__dirname, "fixtures", "SP260508-alignment-2.docx"))));

beforeAll(async () => {
  await withPlatformScope("shared material fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `shared-${Date.now()}`, legalName: "Shared Ltd", displayName: "Shared", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    const [user] = await tx.insert(users).values({ organisationId, email: "admin@shared.test", firstName: "Admin", lastName: "Test", status: "active" }).returning({ id: users.id });
    adminId = user.id;
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role: "tenant_admin" });
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Shared Programme" }).returning({ id: qualifications.id });
    qualificationId = qualification.id;
    const [km01] = await tx
      .insert(curriculumModules)
      .values({ organisationId, qualificationId, component: "knowledge", code: "KM01", title: "Overview of RPL" })
      .returning({ id: curriculumModules.id });
    for (const [index, code] of ["SU1", "SU2"].entries()) {
      const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code, title: code, sortOrder: index }).returning({ id: studyUnits.id });
      ids[code] = unit.id;
      await tx.insert(studyUnitModules).values({ organisationId, studyUnitId: unit.id, curriculumModuleId: km01.id });
    }
    const file = (kind: string, filename: string, extra: Record<string, unknown>) => ({
      organisationId,
      kind: kind as never,
      title: filename.replace(/\.\w+$/, ""),
      filename,
      storageKey: `test/${filename}`,
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      sha256: filename,
      ...extra,
    });
    await tx.insert(programmeDocuments).values([
      file("alignment_matrix", "Rollout Schedule & Module Alignment.docx", { qualificationId, extractedText: alignment }),
      // Covers KT01 (SU1) and KT03 (SU2), so it is filed in SU2.
      file("theory_guide", "Research and implementation notes.docx", { qualificationId, studyUnitId: ids.SU2, extractedText: "This guide covers KM-01 KT01 and KM-01 KT03." }),
      // Covers SU1 only.
      file("theory_guide", "RPL KM1 KT4.docx", { qualificationId, studyUnitId: ids.SU1, extractedText: null }),
    ]);
  });
});

afterAll(async () => {
  await withPlatformScope("shared material teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("material and workbooks shared between study units", () => {
  it("offers material filed in a later unit to every earlier unit it covers", async () => {
    const shared = await sharedLinksOf(admin(), qualificationId);
    expect(shared.material.get("SU1")?.map((one) => [one.title, one.from])).toEqual([["Research and implementation notes", "SU2"]]);
    // Nothing goes the other way, and material for one unit stays there.
    expect(shared.material.get("SU2")).toBeUndefined();
  });

  it("opens from the start a workbook the alignment also lists for an earlier unit", async () => {
    const shared = await sharedLinksOf(admin(), qualificationId);
    expect([...(shared.sharedWithEarlier.get("SU2") ?? [])]).toEqual(["workbook:1"]);
    expect(shared.sharedWithEarlier.get("SU1")).toBeUndefined();
  });
});
