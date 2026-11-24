/**
 * A learner handbook filed for the whole programme reaches its learners
 * (Roland, 24 November 2026, SP-220320: the handbook was filed and no learner
 * page showed it). It follows the cohort: a learner opens it once something
 * of the programme is released to them, and staff always may.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { courseSteps, courses, enrolments, organisations, programmeDocuments, qualifications, studyUnits, users } from "@/db/schema";
import { programmeHandbooks, readProgrammeHandbook } from "@/lib/learner-unit";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let qualificationId: string;
const ids: Record<string, string> = {};
const as = (userId: string, role: Role): AuthenticatedSession => ({
  sessionId: "0",
  userId,
  organisationId,
  email: `${role}@handbook.test`,
  firstName: role,
  lastName: "Test",
  roles: [role],
  permissions: permissionsFor({ roles: [role] }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("programme handbook fixture: a programme with a handbook, staff, an enrolled learner and an outsider", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `handbook-${Date.now()}`, legalName: "Handbook Ltd", displayName: "Handbook", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const name of ["admin", "learner", "outsider"]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@handbook.test`, firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
    }
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Handbook Programme" }).returning({ id: qualifications.id });
    qualificationId = qualification.id;
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code: "SU1", title: "SU1", sortOrder: 0 }).returning({ id: studyUnits.id });
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published", studyUnitId: unit.id }).returning({ id: courses.id });
    await tx.insert(enrolments).values({ organisationId, userId: ids.learner, courseId: course.id });
    const doc = (kind: string, filename: string, studyUnitId: string | null) => ({
      organisationId,
      qualificationId,
      studyUnitId,
      kind: kind as never,
      title: filename.replace(/\.\w+$/, ""),
      filename,
      storageKey: `test/${filename}`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 1,
      sha256: `${filename}-${Date.now()}`,
    });
    const rows = await tx
      .insert(programmeDocuments)
      .values([
        doc("learner_handbook", "Learner Handbook.docx", null),
        doc("summative_memorandum", "Assessor Guide.docx", null),
        doc("theory_guide", "Unit Guide.docx", unit.id),
      ])
      .returning({ id: programmeDocuments.id, filename: programmeDocuments.filename });
    for (const row of rows) ids[row.filename] = row.id;
    // The unit's one step, held shut until a date a long way off.
    const [step] = await tx
      .insert(courseSteps)
      .values({ organisationId, courseId: course.id, kind: "document", programmeDocumentId: ids["Unit Guide.docx"], release: "open", availableFrom: new Date("2099-01-01") })
      .returning({ id: courseSteps.id });
    ids.step = step.id;
  });
});

afterAll(async () => {
  await withPlatformScope("programme handbook teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
  });
});

describe("a handbook for the whole programme", () => {
  it("is shown to staff, open, and nothing else filed for the programme is", async () => {
    const { items, open } = await programmeHandbooks(as(ids.admin, "tenant_admin"), qualificationId);
    expect(items.map((one) => one.title)).toEqual(["Learner Handbook"]);
    expect(open).toBe(true);
  });

  it("is listed for an enrolled learner, and shut while nothing of the programme is released", async () => {
    const { items, open } = await programmeHandbooks(as(ids.learner, "learner"), qualificationId);
    expect(items.map((one) => one.title)).toEqual(["Learner Handbook"]);
    expect(open).toBe(false);
    await expect(readProgrammeHandbook(as(ids.learner, "learner"), ids["Learner Handbook.docx"])).rejects.toThrow(/opens when your cohort starts/);
  });

  it("opens for the learner once something of the programme is released", async () => {
    await withPlatformScope("programme handbook: the unit's step becomes due", (tx) =>
      tx.update(courseSteps).set({ availableFrom: new Date("2020-01-01") }).where(eq(courseSteps.id, ids.step)),
    );
    expect((await programmeHandbooks(as(ids.learner, "learner"), qualificationId)).open).toBe(true);
  });

  it("is not shown to someone who is not on the programme", async () => {
    expect((await programmeHandbooks(as(ids.outsider, "learner"), qualificationId)).items).toEqual([]);
    await expect(readProgrammeHandbook(as(ids.outsider, "learner"), ids["Learner Handbook.docx"])).rejects.toThrow(/Not found/);
  });

  it("never hands over an assessor's document or a unit's own guide by this route", async () => {
    await expect(readProgrammeHandbook(as(ids.admin, "tenant_admin"), ids["Assessor Guide.docx"])).rejects.toThrow(/Not found/);
    await expect(readProgrammeHandbook(as(ids.admin, "tenant_admin"), ids["Unit Guide.docx"])).rejects.toThrow(/Not found/);
  });
});
