/**
 * A skills development facilitator enrolling an employer's staff from a
 * spreadsheet, into a cohort, as learners and nothing else (Heidi's role
 * specifications, job sheet D52 (6), 18 November 2026).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { cohortMembers, cohorts, courses, organisations, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import { commitRoster, type RosterProposal } from "@/lib/roster-import";
import { invitePerson } from "@/lib/people";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const sessionFor = (name: string, roles: Role[]): AuthenticatedSession => ({
  sessionId: "0",
  userId: ids[name],
  organisationId,
  email: `${name}@bulk.test`,
  firstName: name,
  lastName: "Test",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});

const row = (line: number, email: string, firstName: string) => ({ line, values: { email, firstName, lastName: "Employee" }, problems: [] });
const proposal = (rows: ReturnType<typeof row>[]) => ({ filename: "staff.xlsx", headings: [], detection: {}, rows, headerLine: 1, assisted: [], warnings: [] }) as unknown as RosterProposal;

beforeAll(async () => {
  await withPlatformScope("bulk enrol fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `bulk-${Date.now()}`, legalName: "Bulk Ltd", displayName: "Bulk", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const [name, role] of [["sdf", "skills_development_facilitator"], ["known", "learner"]] as [string, Role][]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@bulk.test`, passwordHash: "x", firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Bulk Qualification" }).returning({ id: qualifications.id });
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit" }).returning({ id: studyUnits.id });
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published", studyUnitId: unit.id }).returning({ id: courses.id });
    const [cohort] = await tx.insert(cohorts).values({ organisationId, courseId: course.id, name: "June", startDate: "2027-06-01", status: "planned" }).returning({ id: cohorts.id });
    ids.cohort = cohort.id;
  });
});

afterAll(async () => {
  await withPlatformScope("bulk enrol teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("an SDF's bulk enrolment", () => {
  const sdf = () => sessionFor("sdf", ["skills_development_facilitator"]);

  it("creates the learners and puts them in the cohort, and enrols one already on the platform without creating them again", async () => {
    const report = await commitRoster(sdf(), proposal([row(2, "thabo@employer.test", "Thabo"), row(3, "known@bulk.test", "Known")]), {
      roles: ["tenant_admin"],
      cohortId: ids.cohort,
    });
    expect(report).toMatchObject({ created: 1, existing: 1, enrolled: 2, skipped: 0 });

    const members = await withTenant(organisationId, (tx) =>
      tx.select({ email: users.email }).from(cohortMembers).innerJoin(users, eq(users.id, cohortMembers.userId)).where(and(eq(cohortMembers.cohortId, ids.cohort), isNull(cohortMembers.leftAt))),
    );
    expect(members.map((one) => one.email).sort()).toEqual(["known@bulk.test", "thabo@employer.test"]);
  });

  it("creates learners only, whatever role is asked for", async () => {
    const [created] = await withTenant(organisationId, (tx) => tx.select({ id: users.id }).from(users).where(eq(users.email, "thabo@employer.test")));
    const roles = await withTenant(organisationId, (tx) => tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, created.id)));
    expect(roles.map((one) => one.role)).toEqual(["learner"]);
  });

  it("cannot create staff one at a time either", async () => {
    await expect(invitePerson(sdf(), { email: "boss@employer.test", firstName: "Boss", lastName: "Person", roles: ["tenant_admin"] } as never)).rejects.toThrow();
    await expect(invitePerson(sdf(), { email: "learner2@employer.test", firstName: "Lerato", lastName: "Employee", roles: ["learner"] } as never)).resolves.toMatchObject({ userId: expect.any(String) });
  });
});
