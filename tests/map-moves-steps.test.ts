/**
 * A document moved on a built qualification's programme map takes its learner
 * step with it when the qualification is built again (job sheet D60, 24
 * November 2026). Until this, the step stayed in the unit it was first built
 * into. A step a learner has already opened stays, and is listed to check.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { courseSteps, courses, organisations, programmeDocuments, qualifications, stepProgress, studyUnits, userRoles, users } from "@/db/schema";
import { answerFiled } from "@/lib/filed-map";
import { buildQualification } from "@/lib/qualification-build";
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
  email: "admin@mapmoves.test",
  firstName: "Admin",
  lastName: "Test",
  roles: ["tenant_admin"] as Role[],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false,
  aiOn: false,
});

/** The documents each unit's course has as steps, in order, by file name. */
async function stepsByUnit(): Promise<Record<string, string[]>> {
  const rows = await withTenant(organisationId, (tx) =>
    tx
      .select({ unit: studyUnits.code, filename: programmeDocuments.filename })
      .from(courseSteps)
      .innerJoin(courses, eq(courses.id, courseSteps.courseId))
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .innerJoin(programmeDocuments, eq(programmeDocuments.id, courseSteps.programmeDocumentId))
      .where(eq(studyUnits.qualificationId, qualificationId))
      .orderBy(asc(studyUnits.code), asc(courseSteps.sortOrder)),
  );
  const out: Record<string, string[]> = {};
  for (const row of rows) (out[row.unit] ??= []).push(row.filename);
  return out;
}

beforeAll(async () => {
  await withPlatformScope("map moves steps fixture: one provider, two study units, three theory guides", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `mapmoves-${Date.now()}`, legalName: "Map Moves Ltd", displayName: "Map Moves", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    const [user] = await tx.insert(users).values({ organisationId, email: "admin@mapmoves.test", firstName: "Admin", lastName: "Test", status: "active" }).returning({ id: users.id });
    adminId = user.id;
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role: "tenant_admin" });
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Moving Programme" }).returning({ id: qualifications.id });
    qualificationId = qualification.id;
    for (const [index, code] of ["SU1", "SU2"].entries()) {
      const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code, title: code, sortOrder: index }).returning({ id: studyUnits.id });
      ids[code] = unit.id;
    }
    const guide = (filename: string, unit: string) => ({
      organisationId,
      qualificationId,
      studyUnitId: ids[unit],
      kind: "theory_guide" as never,
      title: filename.replace(/\.\w+$/, ""),
      filename,
      storageKey: `test/${filename}`,
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      sha256: `${filename}-${Date.now()}`,
    });
    const rows = await tx
      .insert(programmeDocuments)
      .values([guide("Guide A.docx", "SU1"), guide("Guide B.docx", "SU1"), guide("Guide C.docx", "SU2")])
      .returning({ id: programmeDocuments.id, filename: programmeDocuments.filename });
    for (const row of rows) ids[row.filename] = row.id;
  });
});

afterAll(async () => {
  await withPlatformScope("map moves steps teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
  });
});

describe("building again after the map is changed", () => {
  it("moves a document's step to the unit it is filed in now, after that unit's guides", async () => {
    await buildQualification(admin(), qualificationId);
    expect(await stepsByUnit()).toEqual({ SU1: ["Guide A.docx", "Guide B.docx"], SU2: ["Guide C.docx"] });

    await answerFiled(admin(), qualificationId, { path: ids["Guide B.docx"], field: "unit", value: "SU2" });
    const report = await buildQualification(admin(), qualificationId);
    expect(await stepsByUnit()).toEqual({ SU1: ["Guide A.docx"], SU2: ["Guide C.docx", "Guide B.docx"] });
    expect(report.toCheck.map((one) => one.what)).toContain("Guide B.docx moved from SU1 to SU2, as the programme map says.");

    // Building again changes nothing more.
    await buildQualification(admin(), qualificationId);
    expect(await stepsByUnit()).toEqual({ SU1: ["Guide A.docx"], SU2: ["Guide C.docx", "Guide B.docx"] });
  });

  it("leaves a step a learner has opened, and lists it for a person to check", async () => {
    const [step] = await withTenant(organisationId, (tx) =>
      tx.select({ id: courseSteps.id }).from(courseSteps).where(eq(courseSteps.programmeDocumentId, ids["Guide A.docx"])),
    );
    await withTenant(organisationId, (tx) => tx.insert(stepProgress).values({ organisationId, stepId: step.id, userId: adminId }));

    await answerFiled(admin(), qualificationId, { path: ids["Guide A.docx"], field: "unit", value: "SU2" });
    const report = await buildQualification(admin(), qualificationId);
    expect((await stepsByUnit()).SU1).toEqual(["Guide A.docx"]);
    expect(report.toCheck.map((one) => one.what).join(" ")).toMatch(/Guide A\.docx is now filed in SU2, but learners have already opened it in SU1/);
  });
});
