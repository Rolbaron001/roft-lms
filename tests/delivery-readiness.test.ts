/**
 * The steps after a qualification is built: its people, a cohort, and
 * learners in the cohort (Roland, 17 November 2026: uploading starts "a whole
 * process", through to material reaching learners on their cohort's schedule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { cohortMembers, cohorts, courses, organisations, programmeStaff, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import { deliveryReadiness } from "@/lib/delivery-readiness";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await withPlatformScope("delivery readiness fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `delivery-${Date.now()}`, legalName: "Delivery Ltd", displayName: "Delivery", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const name of ["admin", "facilitator", "assessor", "learner1", "learner2"]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@delivery.test`, passwordHash: "x", firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
    }
    await tx.insert(userRoles).values({ organisationId, userId: ids.admin, role: "tenant_admin" });
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Delivery Qualification" }).returning({ id: qualifications.id });
    ids.qualification = qualification.id;
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit one" }).returning({ id: studyUnits.id });
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "draft", studyUnitId: unit.id }).returning({ id: courses.id });
    ids.course = course.id;
  });
  const roles: Role[] = ["tenant_admin"];
  admin = { sessionId: "0", userId: ids.admin, organisationId, email: "admin@delivery.test", firstName: "A", lastName: "B", roles, permissions: permissionsFor({ roles }), mustChangePassword: false, aiOn: false };
});

afterAll(async () => {
  await withPlatformScope("delivery readiness teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("what a built qualification still needs before learners work through it", () => {
  it("starts with nobody named, no cohort and no learners", async () => {
    expect(await deliveryReadiness(admin, ids.qualification)).toEqual({
      staff: { facilitator: 0, assessor: 0, moderator: 0 },
      cohorts: [],
      learners: 0,
      rolloutScheduleFiled: false,
    });
  });

  it("counts the people named, a cohort on one of its study units, and that cohort's learners", async () => {
    await withPlatformScope("delivery readiness: people and cohort", async (tx) => {
      await tx.insert(programmeStaff).values([
        { organisationId, userId: ids.facilitator, capacity: "facilitator", qualificationId: ids.qualification },
        { organisationId, userId: ids.assessor, capacity: "assessor", qualificationId: ids.qualification },
      ]);
      const [cohort] = await tx.insert(cohorts).values({ organisationId, courseId: ids.course, name: "January", startDate: "2027-01-04", status: "running" }).returning({ id: cohorts.id });
      await tx.insert(cohortMembers).values([
        { organisationId, cohortId: cohort.id, userId: ids.learner1 },
        { organisationId, cohortId: cohort.id, userId: ids.learner2 },
      ]);
    });
    const readiness = await deliveryReadiness(admin, ids.qualification);
    expect(readiness.staff).toEqual({ facilitator: 1, assessor: 1, moderator: 0 });
    expect(readiness.cohorts.map((one) => [one.name, one.learners])).toEqual([["January", 2]]);
    expect(readiness.learners).toBe(2);
  });
});
