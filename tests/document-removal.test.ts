/**
 * Taking one document off a programme (job sheet D63, 25 November 2026):
 * with a reason, optionally kept in the Library, and refused where a learner's
 * path depends on it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { courseSteps, courses, libraryDocuments, organisations, programmeDocuments, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { removeProgrammeDocument } from "@/lib/document-removal";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let otherOrganisation: string;
let adminId: string;
const ids: Record<string, string> = {};
const admin = (organisation = organisationId): AuthenticatedSession => ({
  sessionId: "0",
  userId: adminId,
  organisationId: organisation,
  email: "admin@removal.test",
  firstName: "Admin",
  lastName: "Test",
  roles: ["tenant_admin"] as Role[],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("document removal fixture: a programme with an auditor's matrix and a guide on a path", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `removal-${Date.now()}`, legalName: "Removal Ltd", displayName: "Removal", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    const [other] = await tx.insert(organisations).values({ slug: `removal-other-${Date.now()}`, legalName: "Other Ltd", displayName: "Other", status: "active" }).returning({ id: organisations.id });
    otherOrganisation = other.id;
    const [user] = await tx.insert(users).values({ organisationId, email: "admin@removal.test", firstName: "Admin", lastName: "Test", status: "active" }).returning({ id: users.id });
    adminId = user.id;
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role: "tenant_admin" });
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "RPL Advisor" }).returning({ id: qualifications.id });
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "SU1", sortOrder: 0 }).returning({ id: studyUnits.id });
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", studyUnitId: unit.id }).returning({ id: courses.id });
    const file = (kind: string, filename: string, studyUnitId: string | null) => ({
      organisationId,
      qualificationId: qualification.id,
      studyUnitId,
      kind: kind as never,
      title: filename.replace(/\.\w+$/, ""),
      filename,
      storageKey: `test/${filename}`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 10,
      sha256: `${filename}-${Date.now()}`,
    });
    const rows = await tx
      .insert(programmeDocuments)
      .values([file("learning_programme_guide", "Learning Material Matrix RPL Advisor.docx", null), file("theory_guide", "SU1 Guide.docx", unit.id)])
      .returning({ id: programmeDocuments.id, filename: programmeDocuments.filename });
    for (const row of rows) ids[row.filename] = row.id;
    await tx.insert(courseSteps).values({ organisationId, courseId: course.id, kind: "document", programmeDocumentId: ids["SU1 Guide.docx"], release: "open" });
  });
});

afterAll(async () => {
  await withPlatformScope("document removal teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
    await tx.delete(organisations).where(eq(organisations.id, otherOrganisation));
  });
});

describe("taking a document off a programme", () => {
  it("needs a reason", async () => {
    await expect(removeProgrammeDocument(admin(), ids["Learning Material Matrix RPL Advisor.docx"], { reason: "no" })).rejects.toThrow(/why it is being removed/);
  });

  it("is refused while a learner's path uses it, saying where", async () => {
    await expect(removeProgrammeDocument(admin(), ids["SU1 Guide.docx"], { reason: "Filed in the wrong programme." })).rejects.toThrow(/step on the learners' path in SU1/);
  });

  it("cannot reach another provider's document", async () => {
    await expect(
      removeProgrammeDocument(admin(otherOrganisation), ids["Learning Material Matrix RPL Advisor.docx"], { reason: "Not ours to remove, surely." }),
    ).rejects.toThrow(/not found/);
  });

  it("keeps it in the Library under the chosen category, out of learners' sight, and off the programme", async () => {
    const { libraryId } = await removeProgrammeDocument(admin(), ids["Learning Material Matrix RPL Advisor.docx"], {
      reason: "For QCTO auditors checking accreditation only, not for this programme's folder.",
      keepInLibraryAs: "accreditation",
    });
    const [kept] = await withTenant(organisationId, (tx) => tx.select().from(libraryDocuments).where(eq(libraryDocuments.id, libraryId!)));
    expect(kept).toMatchObject({ category: "accreditation", visibleToAll: false, filename: "Learning Material Matrix RPL Advisor.docx", storageKey: "test/Learning Material Matrix RPL Advisor.docx" });
    const left = await withTenant(organisationId, (tx) =>
      tx.select({ id: programmeDocuments.id }).from(programmeDocuments).where(eq(programmeDocuments.id, ids["Learning Material Matrix RPL Advisor.docx"])),
    );
    expect(left).toHaveLength(0);
  });
});
