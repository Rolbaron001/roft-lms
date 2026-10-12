/**
 * A learner lodges their own appeals and concerns (Roland, 12 October 2026),
 * against a live database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  assessmentDecisions,
  assessments,
  assessmentSubmissions,
  cohortMembers,
  cohorts,
  courses,
  notifications,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import { acknowledgeAppeal, learnerAppeals, lodgeAppeal, resultsToAppeal } from "@/lib/appeals";
import { lodgeGrievance } from "@/lib/conduct";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

const ZONE = "Africa/Johannesburg";
let organisationId: string;
const people: Record<string, string> = {};
let cohortId: string;
let assessmentId: string;

function as(name: string, roles: Role[]): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: people[name],
    organisationId,
    email: `${name}@example.test`,
    firstName: name,
    lastName: "Tester",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  const slug = `myappeals-${Date.now()}`;
  await withPlatformScope("learner appeals test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Learner Appeals Co", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;
    for (const [name, role] of [["admin", "tenant_admin"], ["assessor", "assessor"], ["learner", "learner"], ["other", "learner"]] as const) {
      const [user] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
      people[name] = user.id;
    }
    const [course] = await tx.insert(courses).values({ organisationId, title: "Appeals course", status: "published" }).returning({ id: courses.id });
    const [cohort] = await tx.insert(cohorts).values({ organisationId, courseId: course.id, name: "Appeals cohort", startDate: "2026-09-01", status: "running" }).returning({ id: cohorts.id });
    cohortId = cohort.id;
    await tx.insert(cohortMembers).values({ organisationId, cohortId, userId: people.learner });
    const [assessment] = await tx.insert(assessments).values({ organisationId, courseId: course.id, title: "Summative one", status: "published", purpose: "summative" }).returning({ id: assessments.id });
    assessmentId = assessment.id;
    const [submission] = await tx
      .insert(assessmentSubmissions)
      .values({ organisationId, assessmentId, userId: people.learner, status: "submitted", submittedAt: new Date() })
      .returning({ id: assessmentSubmissions.id });
    await tx.insert(assessmentDecisions).values({ organisationId, submissionId: submission.id, assessorId: people.assessor, outcome: "not_yet_competent", signedAt: new Date() });
  });
});

afterAll(async () => {
  await withPlatformScope("learner appeals test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("a learner's own appeal", () => {
  it("offers the learner's decided results, with the day each was decided", async () => {
    const results = await resultsToAppeal(as("learner", ["learner"]), ZONE);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ assessmentId, title: "Summative one", outcome: "not_yet_competent", cohortId });
    expect(results[0].decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lodges one in the learner's own name", async () => {
    await lodgeAppeal(as("learner", ["learner"]), ZONE, {
      learnerId: people.learner,
      cohortId,
      ground: "result",
      assessmentId,
      triggeredOn: today(),
      statement: "The marks for section B do not match the memorandum.",
    });
    const mine = await learnerAppeals(as("learner", ["learner"]), people.learner);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("lodged");
  });

  it("refuses one learner lodging in another's name", async () => {
    await expect(
      lodgeAppeal(as("other", ["learner"]), ZONE, {
        learnerId: people.learner,
        cohortId,
        ground: "assessor_conduct",
        triggeredOn: today(),
        statement: "Lodged for someone else, which is not allowed.",
      }),
    ).rejects.toThrow();
  });

  it("tells the learner when it is acknowledged", async () => {
    const [appeal] = await learnerAppeals(as("learner", ["learner"]), people.learner);
    await acknowledgeAppeal(as("admin", ["tenant_admin"]), appeal.id);
    const told = await withPlatformScope("learner appeals test read", (tx) =>
      tx.select({ subject: notifications.subject, linkPath: notifications.linkPath }).from(notifications)
        .where(and(eq(notifications.userId, people.learner), eq(notifications.kind, "appeal.acknowledged"))),
    );
    expect(told).toEqual([{ subject: "Your appeal has been acknowledged", linkPath: "/my-appeals" }]);
  });
});

describe("a learner's own concern", () => {
  it("lodges in the learner's own name and refuses another's", async () => {
    await expect(
      lodgeGrievance(as("learner", ["learner"]), ZONE, { learnerId: people.learner, nature: "The venue had no working air conditioning for a week." }),
    ).resolves.toBeDefined();
    await expect(
      lodgeGrievance(as("other", ["learner"]), ZONE, { learnerId: people.learner, nature: "Raised in somebody else's name, which is refused." }),
    ).rejects.toThrow();
  });
});
