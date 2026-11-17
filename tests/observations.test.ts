/**
 * Observations of a learner's behaviour and progress (Heidi's role
 * specifications, job sheet D52 (2), 17 November 2026).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { cohortMembers, cohorts, courses, organisations, programmeStaff, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import { logObservation, observationsOf } from "@/lib/observations";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const sessionFor = (name: string, roles: Role[]): AuthenticatedSession => ({
  sessionId: "0",
  userId: ids[name],
  organisationId,
  email: `${name}@observe.test`,
  firstName: name,
  lastName: "Test",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("observations fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `observe-${Date.now()}`, legalName: "Observe Ltd", displayName: "Observe", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const [name, role] of [["facilitator", "instructor"], ["other", "instructor"], ["qa", "quality_assurer"], ["learner", "learner"]] as [string, Role][]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@observe.test`, passwordHash: "x", firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Observe Qualification" }).returning({ id: qualifications.id });
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit" }).returning({ id: studyUnits.id });
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published", studyUnitId: unit.id }).returning({ id: courses.id });
    const [cohort] = await tx.insert(cohorts).values({ organisationId, courseId: course.id, name: "April", startDate: "2027-04-01", status: "running" }).returning({ id: cohorts.id });
    ids.cohort = cohort.id;
    await tx.insert(programmeStaff).values({ organisationId, userId: ids.facilitator, capacity: "facilitator", qualificationId: qualification.id });
    await tx.insert(cohortMembers).values({ organisationId, cohortId: cohort.id, userId: ids.learner });
  });
});

afterAll(async () => {
  await withPlatformScope("observations teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("observations of a learner", () => {
  it("are logged by the learner's facilitator and read by them and the Quality Assurer", async () => {
    await logObservation(sessionFor("facilitator", ["instructor"]), {
      learnerId: ids.learner,
      kind: "behaviour",
      observedOn: "2027-04-08",
      note: "Arrived late twice this week; asked about transport.",
      cohortId: ids.cohort,
    });
    const seen = await observationsOf(sessionFor("facilitator", ["instructor"]), ids.learner);
    expect(seen).toMatchObject([{ kind: "behaviour", observedOn: "2027-04-08", cohort: "April", author: "facilitator Test" }]);
    expect(await observationsOf(sessionFor("qa", ["quality_assurer"]), ids.learner)).toHaveLength(1);
  });

  it("are refused to a facilitator not assigned to the learner, and not shown to the learner", async () => {
    await expect(
      logObservation(sessionFor("other", ["instructor"]), { learnerId: ids.learner, kind: "progress", observedOn: "2027-04-09", note: "Not my learner." }),
    ).rejects.toThrow(/not on a programme you are assigned to/);
    expect(await observationsOf(sessionFor("other", ["instructor"]), ids.learner)).toEqual([]);
    expect(await observationsOf(sessionFor("learner", ["learner"]), ids.learner)).toEqual([]);
  });

  it("refuses an unknown kind and an empty note", async () => {
    const facilitator = sessionFor("facilitator", ["instructor"]);
    await expect(logObservation(facilitator, { learnerId: ids.learner, kind: "gossip", observedOn: "2027-04-09", note: "Something" })).rejects.toThrow(/Choose what/);
    await expect(logObservation(facilitator, { learnerId: ids.learner, kind: "progress", observedOn: "2027-04-09", note: " " })).rejects.toThrow(/Write the observation/);
  });
});
