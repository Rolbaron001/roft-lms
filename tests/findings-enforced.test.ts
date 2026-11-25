/**
 * Findings that hold a programme back are enforced, and pass only by being
 * accepted with a logged reason (job sheet D62, Roland, 25 November 2026).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { auditLog, organisations, programmeDocuments, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { acceptFinding, verificationOf, withdrawAcceptance } from "@/lib/qualification-build";
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
  email: "admin@findings.test",
  firstName: "Avery",
  lastName: "Admin",
  roles: ["tenant_admin"] as Role[],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("findings fixture: a programme with another programme's matrix filed in it", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `findings-${Date.now()}`, legalName: "Findings Ltd", displayName: "Findings", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    const [user] = await tx.insert(users).values({ organisationId, email: "admin@findings.test", firstName: "Avery", lastName: "Admin", status: "active" }).returning({ id: users.id });
    adminId = user.id;
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role: "tenant_admin" });
    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId, title: "RPL Advisor", curriculumCode: "900537-000-00-00", saqaId: "SP-260508" })
      .returning({ id: qualifications.id });
    qualificationId = qualification.id;
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code: "SU1", title: "Foundations", sortOrder: 0 }).returning({ id: studyUnits.id });
    ids.unit = unit.id;
    const file = (kind: string, filename: string, extractedText: string) => ({
      organisationId,
      qualificationId,
      studyUnitId: null,
      kind: kind as never,
      title: filename.replace(/\.\w+$/, ""),
      filename,
      storageKey: `test/${filename}`,
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      sha256: `${filename}-${Date.now()}`,
      extractedText,
    });
    const rows = await tx
      .insert(programmeDocuments)
      .values([
        file("alignment_matrix", "CA LD_Advisor_Alignment_Matrix.docx", "Learning and Development Advisor (Curriculum Code: 242401002) 242401002-KM-01 242401002-PM-01"),
        file("alignment_matrix", "Rollout Schedule - RPL Advisor (SP-260508).docx", "Curriculum Code: 900537-000-00-00 900537-000-00-KM-01"),
        file("other", "Notes to self.docx", ""),
      ])
      .returning({ id: programmeDocuments.id, filename: programmeDocuments.filename });
    for (const row of rows) ids[row.filename] = row.id;
  });
});

afterAll(async () => {
  await withPlatformScope("findings teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
  });
});

describe("findings that hold a programme back", () => {
  it("name another programme's matrix, where it is and how to fix it, and hold the programme back", async () => {
    const verification = await verificationOf(admin(), qualificationId);
    const foreign = verification.programme.blocking.find((one) => one.key === `foreign:${ids["CA LD_Advisor_Alignment_Matrix.docx"]}`);
    expect(foreign?.what).toMatch(/maps curriculum 242401002, not this programme's/);
    expect(foreign?.where).toMatch(/CA LD_Advisor_Alignment_Matrix\.docx/);
    expect(foreign?.fix).toMatch(/select Remove from this programme/);
    expect(foreign?.acceptable).toBe(true);
    // Its own schedule is not asked about.
    expect(verification.programme.blocking).toHaveLength(1);
    // An unrecognised file is worth a look, never a block.
    expect(verification.programme.toCheck.map((one) => one.where)).toEqual(["Notes to self.docx"]);
    expect(verification.ready).toBe(false);
  });

  it("will not be accepted without a reason, nor where it cannot be gone live with", async () => {
    const key = `foreign:${ids["CA LD_Advisor_Alignment_Matrix.docx"]}`;
    expect(await acceptFinding(admin(), qualificationId, key, "ok")).toMatchObject({ ok: false });
    // SU1 is not built: that has to be done, not accepted.
    expect(await acceptFinding(admin(), qualificationId, `unbuilt:${ids.unit}`, "We will build it later on, honestly.")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/cannot be accepted/),
    });
  });

  it("passes once accepted with a reason, which is shown and logged, and holds again when withdrawn", async () => {
    const key = `foreign:${ids["CA LD_Advisor_Alignment_Matrix.docx"]}`;
    expect(await acceptFinding(admin(), qualificationId, key, "Kept as background reading on the L&D Advisor's RPL module.")).toEqual({ ok: true });

    let verification = await verificationOf(admin(), qualificationId);
    expect(verification.programme.blocking).toHaveLength(0);
    expect(verification.accepted[0].accepted).toMatchObject({ reason: "Kept as background reading on the L&D Advisor's RPL module.", by: "Avery Admin" });

    const logged = await withPlatformScope("findings: read the audit trail for the acceptance", (tx) =>
      tx.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.organisationId, organisationId), eq(auditLog.action, "qualification.finding_accepted"))),
    );
    expect(logged).toHaveLength(1);

    await withdrawAcceptance(admin(), qualificationId, key);
    verification = await verificationOf(admin(), qualificationId);
    expect(verification.programme.blocking).toHaveLength(1);
    expect(verification.accepted).toHaveLength(0);
  });
});
