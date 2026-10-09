/**
 * Who facilitates, assesses and moderates each programme (job sheet D27, 9
 * October 2026), against a live database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { cohorts, courses, organisations, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { assignStaff, coursesOf, programmeStaffFor, setCohortFacilitator, StaffError } from "@/lib/programme-staff";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const people: Record<string, string> = {};
let qualificationId: string;
let unitOne: string;
let unitTwo: string;
let courseOne: string;
let courseTwo: string;
let cohortId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "staff@example.test",
    firstName: "Staff",
    lastName: "Tester",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `staff-${Date.now()}`;
  await withPlatformScope("programme staff test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Staff Test Co", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;
    for (const [name, role] of [
      ["admin", "tenant_admin"],
      ["anna", "instructor"],
      ["ben", "instructor"],
      ["cara", "assessor"],
      ["dan", "moderator"],
      ["eve", "learner"],
    ] as const) {
      const [user] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
      people[name] = user.id;
    }
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Occupational Certificate: Staffing" }).returning({ id: qualifications.id });
    qualificationId = qualification.id;
    const [one] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code: "SU1", title: "One" }).returning({ id: studyUnits.id });
    const [two] = await tx.insert(studyUnits).values({ organisationId, qualificationId, code: "SU2", title: "Two" }).returning({ id: studyUnits.id });
    unitOne = one.id;
    unitTwo = two.id;
    const [c1] = await tx.insert(courses).values({ organisationId, studyUnitId: unitOne, title: "SU1 One", status: "published" }).returning({ id: courses.id });
    const [c2] = await tx.insert(courses).values({ organisationId, studyUnitId: unitTwo, title: "SU2 Two", status: "published" }).returning({ id: courses.id });
    courseOne = c1.id;
    courseTwo = c2.id;
    const [cohort] = await tx.insert(cohorts).values({ organisationId, qualificationId, name: "Staffing 2026", startDate: "2026-10-01" }).returning({ id: cohorts.id });
    cohortId = cohort.id;
  });
});

afterAll(async () => {
  await withPlatformScope("programme staff test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("people named on a programme", () => {
  it("names a facilitator and an assessor on the qualification, with the assessor's registration", async () => {
    const admin = sessionFor(["tenant_admin"], people.admin);
    await assignStaff(admin, { userId: people.anna, capacity: "facilitator", qualificationId });
    await assignStaff(admin, { userId: people.cara, capacity: "assessor", qualificationId, registrationNumber: "AS-123", registrationExpiresOn: "2027-06-30" });
    const rows = await programmeStaffFor(admin, { qualificationId });
    expect(rows.map((row) => [row.capacity, row.name, row.registrationNumber, row.inherited])).toEqual([
      ["facilitator", "anna Tester", null, false],
      ["assessor", "cara Tester", "AS-123", false],
    ]);
  });

  it("gives a study unit the qualification's people until it names its own", async () => {
    const admin = sessionFor(["tenant_admin"], people.admin);
    const inherited = await programmeStaffFor(admin, { courseId: courseTwo });
    expect(inherited.map((row) => [row.capacity, row.name, row.inherited])).toEqual([
      ["facilitator", "anna Tester", true],
      ["assessor", "cara Tester", true],
    ]);

    await assignStaff(admin, { userId: people.ben, capacity: "facilitator", studyUnitId: unitTwo });
    const own = await programmeStaffFor(admin, { courseId: courseTwo });
    expect(own.map((row) => [row.capacity, row.name, row.inherited])).toEqual([
      ["facilitator", "ben Tester", false],
      ["assessor", "cara Tester", true],
    ]);
  });

  it("knows which courses are a person's own, through the qualification or the study unit", async () => {
    const admin = sessionFor(["tenant_admin"], people.admin);
    expect([...(await coursesOf(admin, people.cara, "assessor"))].sort()).toEqual([courseOne, courseTwo].sort());
    expect([...(await coursesOf(admin, people.ben, "facilitator"))]).toEqual([courseTwo]);
  });

  it("refuses someone without the role, the same person twice, and anyone but an administrator", async () => {
    const admin = sessionFor(["tenant_admin"], people.admin);
    await expect(assignStaff(admin, { userId: people.eve, capacity: "assessor", qualificationId })).rejects.toBeInstanceOf(StaffError);
    await expect(assignStaff(admin, { userId: people.anna, capacity: "facilitator", qualificationId })).rejects.toBeInstanceOf(StaffError);
    await expect(assignStaff(admin, { userId: people.dan, capacity: "moderator" })).rejects.toBeInstanceOf(StaffError);
    await expect(assignStaff(sessionFor(["instructor"], people.anna), { userId: people.dan, capacity: "moderator", qualificationId })).rejects.toThrow();
  });

  it("sets a cohort's facilitator, only from those holding the role", async () => {
    const admin = sessionFor(["tenant_admin"], people.admin);
    await setCohortFacilitator(admin, cohortId, people.anna);
    const [row] = await withPlatformScope("programme staff test read", (tx) => tx.select({ facilitatorId: cohorts.facilitatorId }).from(cohorts).where(eq(cohorts.id, cohortId)));
    expect(row.facilitatorId).toBe(people.anna);
    await expect(setCohortFacilitator(admin, cohortId, people.cara)).rejects.toBeInstanceOf(StaffError);
  });
});
