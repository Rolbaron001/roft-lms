/**
 * Every assessed decision a moderator may moderate, narrowed by cohort,
 * qualification or assessor, and added to the sample by choice (Heidi's role
 * specifications, job sheet D52 (3), 17 November 2026).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  cohortMembers,
  cohorts,
  courses,
  moderationQueue,
  organisations,
  programmeStaff,
  qualifications,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import { addToSample, CHOSEN, decisionsToModerate } from "@/lib/moderation-sample";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const sessionFor = (name: string, roles: Role[]): AuthenticatedSession => ({
  sessionId: "0",
  userId: ids[name],
  organisationId,
  email: `${name}@sample.test`,
  firstName: name,
  lastName: "Test",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("moderation sample fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `sample-${Date.now()}`, legalName: "Sample Ltd", displayName: "Sample", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const [name, role] of [["moderator", "moderator"], ["outsider", "moderator"], ["assessorA", "assessor"], ["assessorB", "assessor"], ["learner1", "learner"], ["learner2", "learner"]] as [string, Role][]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@sample.test`, passwordHash: "x", firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
    for (const label of ["one", "two"]) {
      const [qualification] = await tx.insert(qualifications).values({ organisationId, title: `Qualification ${label}` }).returning({ id: qualifications.id });
      ids[`q_${label}`] = qualification.id;
      const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit" }).returning({ id: studyUnits.id });
      const [course] = await tx.insert(courses).values({ organisationId, title: `Course ${label}`, status: "published", studyUnitId: unit.id }).returning({ id: courses.id });
      ids[`c_${label}`] = course.id;
      const [assessment] = await tx.insert(assessments).values({ organisationId, courseId: course.id, title: `Workbook ${label}` }).returning({ id: assessments.id });
      ids[`a_${label}`] = assessment.id;
      await tx.insert(programmeStaff).values({ organisationId, userId: ids.moderator, capacity: "moderator", qualificationId: qualification.id });
    }
    const [cohort] = await tx.insert(cohorts).values({ organisationId, courseId: ids.c_one, name: "May", startDate: "2027-05-03", status: "running" }).returning({ id: cohorts.id });
    ids.cohort = cohort.id;
    await tx.insert(cohortMembers).values({ organisationId, cohortId: cohort.id, userId: ids.learner1 });
    // learner1 on qualification one, assessed by A; learner2 on qualification two, assessed by B.
    for (const [learner, assessment, assessor] of [["learner1", "a_one", "assessorA"], ["learner2", "a_two", "assessorB"]]) {
      const [submission] = await tx.insert(assessmentSubmissions).values({ organisationId, assessmentId: ids[assessment], userId: ids[learner], status: "submitted" }).returning({ id: assessmentSubmissions.id });
      const [decision] = await tx.insert(assessmentDecisions).values({ organisationId, submissionId: submission.id, assessorId: ids[assessor], outcome: "competent", signedAt: new Date() }).returning({ id: assessmentDecisions.id });
      ids[`d_${learner}`] = decision.id;
    }
  });
});

afterAll(async () => {
  await withPlatformScope("moderation sample teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("choosing decisions to moderate", () => {
  const moderator = () => sessionFor("moderator", ["moderator"]);

  it("lists every decision on the programmes moderated, narrowed by cohort, qualification or assessor", async () => {
    expect((await decisionsToModerate(moderator())).map((row) => row.learner).sort()).toEqual(["learner1 Test", "learner2 Test"]);
    expect((await decisionsToModerate(moderator(), { cohortId: ids.cohort })).map((row) => row.learner)).toEqual(["learner1 Test"]);
    expect((await decisionsToModerate(moderator(), { qualificationId: ids.q_two })).map((row) => row.learner)).toEqual(["learner2 Test"]);
    expect((await decisionsToModerate(moderator(), { assessorId: ids.assessorA })).map((row) => row.assessor)).toEqual(["assessorA Test"]);
  });

  it("adds a chosen decision to the sample once, and shows it as sampled", async () => {
    expect(await addToSample(moderator(), [ids.d_learner2])).toBe(1);
    expect(await addToSample(moderator(), [ids.d_learner2])).toBe(0);
    const [queued] = await withTenant(organisationId, (tx) => tx.select({ reason: moderationQueue.samplingReason }).from(moderationQueue).where(eq(moderationQueue.decisionId, ids.d_learner2)));
    expect(queued.reason).toBe(CHOSEN);
    expect((await decisionsToModerate(moderator(), { qualificationId: ids.q_two }))[0].sampled).toBe(CHOSEN);
  });

  it("shows a moderator not named on the programmes nothing, and adds nothing for them", async () => {
    const outsider = sessionFor("outsider", ["moderator"]);
    expect(await decisionsToModerate(outsider)).toEqual([]);
    expect(await addToSample(outsider, [ids.d_learner1])).toBe(0);
  });
});
