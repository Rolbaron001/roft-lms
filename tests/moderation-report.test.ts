/**
 * A Moderation Report the moderator completes and signs off, and the lock
 * signing puts on what it covers (Heidi's role specifications, job sheet D52
 * (4) and (5), 17 November 2026).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  courses,
  moderationRecords,
  organisations,
  programmeStaff,
  qualifications,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import { createReport, getReport, listReports, lockedForVerification, saveReport, signReport } from "@/lib/moderation-report";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const sessionFor = (name: string, roles: Role[]): AuthenticatedSession => ({
  sessionId: "0",
  userId: ids[name],
  organisationId,
  email: `${name}@report.test`,
  firstName: name,
  lastName: "Test",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("moderation report fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `report-${Date.now()}`, legalName: "Report Ltd", displayName: "Report", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const [name, role] of [["moderator", "moderator"], ["other", "moderator"], ["assessor", "assessor"], ["verifier", "external_verifier"], ["l1", "learner"], ["l2", "learner"]] as [string, Role][]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@report.test`, passwordHash: "x", firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Report Qualification" }).returning({ id: qualifications.id });
    ids.qualification = qualification.id;
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit" }).returning({ id: studyUnits.id });
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published", studyUnitId: unit.id }).returning({ id: courses.id });
    const [assessment] = await tx.insert(assessments).values({ organisationId, courseId: course.id, title: "Summative" }).returning({ id: assessments.id });
    await tx.insert(programmeStaff).values({ organisationId, userId: ids.moderator, capacity: "moderator", qualificationId: qualification.id, registrationNumber: "ETDP-MOD-77" });
    for (const learner of ["l1", "l2"]) {
      const [submission] = await tx.insert(assessmentSubmissions).values({ organisationId, assessmentId: assessment.id, userId: ids[learner], status: "submitted" }).returning({ id: assessmentSubmissions.id });
      ids[`s_${learner}`] = submission.id;
      const [decision] = await tx.insert(assessmentDecisions).values({ organisationId, submissionId: submission.id, assessorId: ids.assessor, outcome: "competent", signedAt: new Date() }).returning({ id: assessmentDecisions.id });
      ids[`d_${learner}`] = decision.id;
    }
    // l1's decision is moderated and endorsed; l2's is not.
    await tx.insert(moderationRecords).values({ organisationId, decisionId: ids.d_l1, moderatorId: ids.moderator, outcome: "endorsed", samplingReason: "random" });
  });
});

afterAll(async () => {
  await withPlatformScope("moderation report teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("a Moderation Report", () => {
  const moderator = () => sessionFor("moderator", ["moderator"]);

  it("drafts its figures from the moderation done", async () => {
    ids.report = await createReport(moderator(), { qualificationId: ids.qualification });
    const draft = await getReport(moderator(), ids.report);
    expect(draft?.figures).toMatchObject({ decisions: 2, moderated: 1, endorsed: 1, referredBack: 0, overridden: 0 });
    expect(draft?.figures.byAssessor).toEqual([{ assessor: "assessor Test", decisions: 2, moderated: 1, endorsed: 1, referredBack: 0, overridden: 0 }]);
  });

  it("will not be signed without findings, nor by anyone but its moderator", async () => {
    await expect(signReport(moderator(), ids.report, {})).rejects.toThrow(/findings/);
    await saveReport(moderator(), ids.report, { findings: "Judgements were consistent with the evidence.", recommendations: "None." });
    await expect(signReport(sessionFor("other", ["moderator"]), ids.report, {})).rejects.toThrow(/Only the moderator/);
  });

  it("locks the moderated decisions it covers when signed, and nothing else", async () => {
    expect(await signReport(moderator(), ids.report, {})).toEqual({ locked: 1 });
    await withTenant(organisationId, async (tx) => {
      expect(await lockedForVerification(tx, ids.s_l1)).toBe(true);
      expect(await lockedForVerification(tx, ids.s_l2)).toBe(false);
    });
    const signed = await getReport(moderator(), ids.report);
    expect(signed).toMatchObject({ registrationNumber: "ETDP-MOD-77", findings: "Judgements were consistent with the evidence." });
    expect(signed?.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(saveReport(moderator(), ids.report, { findings: "Changed afterwards", recommendations: "" })).rejects.toThrow(/signed/);
  });

  it("is read by the external verifier once signed", async () => {
    const verifier = sessionFor("verifier", ["external_verifier"]);
    expect((await listReports(verifier)).map((row) => row.id)).toEqual([ids.report]);
    expect(await getReport(verifier, ids.report)).toMatchObject({ figures: { moderated: 1 } });
  });
});
