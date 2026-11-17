/**
 * Heidi's three new roles (13 November 2026; job sheet D51): the Quality
 * Assurer, the Instructional Designer and the Guest.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { assessmentPapers, assessments, cohortMembers, cohorts, courses, organisations, programmeStaff, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { permissionsFor, type Role } from "@/lib/rbac";
import { resolveSession, signIn, type AuthenticatedSession } from "@/lib/session";
import { setAccessEnd, setRoles } from "@/lib/people";
import { guestMayOpenPaper, guestMayOpenQualification, qualificationsOpenToGuests, setOpenToGuests } from "@/lib/guest";
import { auditCsv, auditTrail, credentialsRegister, holdBlocking, liftHold, placeHold } from "@/lib/quality";

describe("what each new role may do", () => {
  const can = (role: Role) => permissionsFor({ roles: [role] });

  it("lets the Quality Assurer read everything, place holds, and change nothing else", () => {
    const qa = can("quality_assurer");
    for (const permission of ["audit:read", "quality:hold", "enrolment:read_all", "evidence:read_all", "records:read"] as const) expect(qa).toContain(permission);
    for (const permission of ["user:invite", "course:author", "assessment:assess", "assessment:moderate", "tenant:manage_settings", "support:read"] as const)
      expect(qa).not.toContain(permission);
  });

  it("lets the Instructional Designer build, and keeps learners' data and grades from them", () => {
    const designer = can("instructional_designer");
    for (const permission of ["course:author", "course:publish", "assessment:author", "qualification:manage"] as const) expect(designer).toContain(permission);
    for (const permission of ["enrolment:read_all", "user:read", "evidence:read_all", "assessment:assess", "certificate:read_all"] as const)
      expect(designer).not.toContain(permission);
  });

  it("gives the Guest the preview and nothing of anybody's records", () => {
    const guest = can("guest");
    expect(guest).toContain("guest:preview");
    for (const permission of ["enrolment:read_all", "enrolment:read_own", "user:read", "evidence:read_all", "assessment:take", "appeal:lodge", "audit:read"] as const)
      expect(guest).not.toContain(permission);
  });
});

const PASSWORD = "correct-horse-battery";
let organisationId: string;
let admin: AuthenticatedSession;
let qa: AuthenticatedSession;
const ids: Record<string, string> = {};

function sessionFor(userId: string, roles: Role[]): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "x@roles.test",
    firstName: "Test",
    lastName: "Person",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await withPlatformScope("new roles test fixture", async (tx) => {
    const [org] = await tx
      .insert(organisations)
      .values({ slug: `new-roles-${Date.now()}`, legalName: "Roles Ltd", displayName: "Roles", status: "active" })
      .returning({ id: organisations.id });
    organisationId = org.id;
    for (const [name, roles] of [["admin", ["tenant_admin"]], ["qa", ["quality_assurer"]], ["guest", []], ["learner", ["learner"]], ["assessor", ["assessor"]]] as [string, Role[]][]) {
      const [user] = await tx
        .insert(users)
        .values({ organisationId: org.id, email: `${name}@roles.test`, passwordHash, firstName: name, lastName: "Test", status: "active" })
        .returning({ id: users.id });
      ids[name] = user.id;
      for (const role of roles) await tx.insert(userRoles).values({ organisationId: org.id, userId: user.id, role });
    }
    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId: org.id, title: "Test Qualification" })
      .returning({ id: qualifications.id });
    ids.qualification = qualification.id;
    const [course] = await tx.insert(courses).values({ organisationId: org.id, title: "Unit", status: "published" }).returning({ id: courses.id });
    const [cohort] = await tx
      .insert(cohorts)
      .values({ organisationId: org.id, courseId: course.id, name: "Held cohort", startDate: "2026-11-01", status: "running" })
      .returning({ id: cohorts.id });
    ids.cohort = cohort.id;
    await tx.insert(cohortMembers).values({ organisationId: org.id, cohortId: cohort.id, userId: ids.learner });
    await tx.insert(programmeStaff).values({ organisationId: org.id, userId: ids.assessor, capacity: "assessor", qualificationId: qualification.id });
  });
  admin = sessionFor(ids.admin, ["tenant_admin"]);
  qa = sessionFor(ids.qa, ["quality_assurer"]);
});

afterAll(async () => {
  await withPlatformScope("new roles test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("the Guest", () => {
  it("is given an access end date with the role, and loses access when it passes", async () => {
    await setRoles(admin, ids.guest, ["guest"]);
    const [row] = await withTenant(organisationId, (tx) => tx.select({ endsAt: users.accessEndsAt }).from(users).where(eq(users.id, ids.guest)));
    expect(row.endsAt).not.toBeNull();
    expect(row.endsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const result = await signIn(organisationId, "guest@roles.test", PASSWORD);
    if (!result.ok) throw new Error("sign-in failed");
    expect(await resolveSession(organisationId, result.token)).not.toBeNull();

    await withTenant(organisationId, (tx) => tx.update(users).set({ accessEndsAt: new Date(Date.now() - 1000) }).where(eq(users.id, ids.guest)));
    expect(await resolveSession(organisationId, result.token)).toBeNull();
    expect((await signIn(organisationId, "guest@roles.test", PASSWORD)).ok).toBe(false);
  });

  it("must keep an end date", async () => {
    await expect(setAccessEnd(admin, ids.guest, null)).rejects.toThrow(/must end/);
    await setAccessEnd(admin, ids.guest, "2099-12-31");
  });

  it("previews only a qualification opened to guests", async () => {
    const guest = sessionFor(ids.guest, ["guest"]);
    expect(await guestMayOpenQualification(guest, ids.qualification)).toBe(false);
    expect(await qualificationsOpenToGuests(guest)).toHaveLength(0);
    await setOpenToGuests(admin, ids.qualification, true);
    expect(await guestMayOpenQualification(guest, ids.qualification)).toBe(true);
    expect((await qualificationsOpenToGuests(guest)).map((one) => one.id)).toEqual([ids.qualification]);
    const learner = sessionFor(ids.learner, ["learner"]);
    expect(await guestMayOpenQualification(learner, ids.qualification)).toBe(false);
  });

  it("previews a paper only inside a qualification opened to guests", async () => {
    const paperId = await withPlatformScope("new roles test: a paper in a study unit", async (tx) => {
      const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: ids.qualification, code: "SU1", title: "Unit one" }).returning({ id: studyUnits.id });
      const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published", studyUnitId: unit.id }).returning({ id: courses.id });
      const [assessment] = await tx.insert(assessments).values({ organisationId, title: "Workbook 1", courseId: course.id }).returning({ id: assessments.id });
      const [paper] = await tx.insert(assessmentPapers).values({ organisationId, assessmentId: assessment.id, code: "WB1" }).returning({ id: assessmentPapers.id });
      return paper.id;
    });
    const guest = sessionFor(ids.guest, ["guest"]);
    expect(await guestMayOpenPaper(guest, paperId)).toBe(true);
    await setOpenToGuests(admin, ids.qualification, false);
    expect(await guestMayOpenPaper(guest, paperId)).toBe(false);
    await setOpenToGuests(admin, ids.qualification, true);
  });
});

describe("the Quality Assurer", () => {
  it("places a hold on a cohort that stops its learners' results, and lifts it", async () => {
    const before = await withTenant(organisationId, (tx) => holdBlocking(tx, { learnerId: ids.learner }));
    expect(before).toBeNull();
    await placeHold(qa, { cohortId: ids.cohort, reason: "Marking irregularity found" });
    const held = await withTenant(organisationId, (tx) => holdBlocking(tx, { learnerId: ids.learner }));
    expect(held).toMatchObject({ on: "cohort", name: "Held cohort", reason: "Marking irregularity found" });
    expect(await withTenant(organisationId, (tx) => holdBlocking(tx, { learnerId: ids.guest }))).toBeNull();

    const [hold] = await withTenant(organisationId, (tx) => tx.query.complianceHolds.findMany());
    await expect(liftHold(qa, hold.id, "")).rejects.toThrow(/what was resolved/);
    await liftHold(qa, hold.id, "Remarked and moderated");
    expect(await withTenant(organisationId, (tx) => holdBlocking(tx, { learnerId: ids.learner }))).toBeNull();
  });

  it("holds a whole qualification", async () => {
    await placeHold(qa, { qualificationId: ids.qualification, reason: "Instrument not aligned" });
    expect(await withTenant(organisationId, (tx) => holdBlocking(tx, { learnerId: ids.guest, qualificationId: ids.qualification }))).toMatchObject({ on: "qualification" });
  });

  it("refuses a hold from someone who may not place one", async () => {
    await expect(placeHold(sessionFor(ids.learner, ["learner"]), { cohortId: ids.cohort, reason: "Not mine to place" })).rejects.toThrow();
  });

  it("flags an assessor named on a programme with no registration", async () => {
    const register = await credentialsRegister(qa, "2026-11-17");
    expect(register).toEqual([expect.objectContaining({ userId: ids.assessor, capacity: "assessor", state: "missing" })]);
    await withTenant(organisationId, (tx) =>
      tx.update(programmeStaff).set({ registrationNumber: "ETDP-123", registrationExpiresOn: "2026-12-01" }).where(eq(programmeStaff.userId, ids.assessor)),
    );
    expect((await credentialsRegister(qa, "2026-11-17"))[0].state).toBe("expiring");
    expect((await credentialsRegister(qa, "2026-12-02"))[0].state).toBe("expired");
  });

  it("reads the audit trail, filtered, and downloads it", async () => {
    const holds = await auditTrail(qa, { action: "compliance_hold" });
    expect(holds.map((row) => row.action)).toEqual(expect.arrayContaining(["compliance_hold.placed", "compliance_hold.lifted"]));
    expect(auditCsv(holds).split("\n")[0]).toBe("When,Who,Role,Action,On,Record,Before,After");
    await expect(auditTrail(sessionFor(ids.learner, ["learner"]), {})).rejects.toThrow();
  });
});
