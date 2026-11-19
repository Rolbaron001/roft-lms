/**
 * A workplace coach's view of a learner (Heidi's role specifications, job
 * sheet D52 (7) to (10), 18 November 2026): progress, a signed observation
 * checklist drafted from the logbook, a witness testimony, readiness feedback,
 * and a message to the learner's facilitator and assessor.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { curriculumModules, notifications, organisations, programmeStaff, userRoles, users } from "@/db/schema";
import { importCurriculum } from "@/lib/curriculum-import";
import { createAgreement, openLogbook } from "@/lib/workplace";
import {
  coachLearners,
  coachLearnerView,
  messageStaff,
  recordObservationChecklist,
  recordReadiness,
  recordWitnessTestimony,
} from "@/lib/coach";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
const sessionFor = (name: string, roles: Role[]): AuthenticatedSession => ({
  sessionId: "0",
  userId: ids[name],
  organisationId,
  email: `${name}@coach.test`,
  firstName: name,
  lastName: "Test",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});
const admin = () => sessionFor("admin", ["tenant_admin"]);
const coach = () => sessionFor("coach", ["workplace_coach"]);
const learner = () => sessionFor("learner", ["learner"]);

beforeAll(async () => {
  await withPlatformScope("coach fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug: `coach-${Date.now()}`, legalName: "Coach Ltd", displayName: "Coach", status: "active" }).returning({ id: organisations.id });
    organisationId = org.id;
    for (const [name, role] of [
      ["admin", "tenant_admin"],
      ["coach", "workplace_coach"],
      ["otherCoach", "workplace_coach"],
      ["learner", "learner"],
      ["facilitator", "instructor"],
    ] as [string, Role][]) {
      const [user] = await tx.insert(users).values({ organisationId, email: `${name}@coach.test`, firstName: name, lastName: "Test", status: "active" }).returning({ id: users.id });
      ids[name] = user.id;
      await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    }
  });
  const code = `coach-${Math.random().toString(36).slice(2, 8)}`;
  const imported = await importCurriculum(admin(), {
    title: `Coach Qualification ${code}`,
    curriculumCode: code,
    modules: [
      {
        component: "workplace",
        code: `${code}-WM-01`,
        title: "Kitchen operations",
        credits: 8,
        topics: [
          {
            code: "WE0101",
            title: "Prepare the kitchen for service",
            elements: [
              { kind: "work_activity", code: "WA0101", description: "Set up the work station." },
              { kind: "work_activity", code: "WA0102", description: "Check stock against the order." },
              { kind: "supporting_evidence", code: "SE01", description: "Stock sheet." },
            ],
            criteria: [{ code: "IAC0101", description: "Station ready on time." }],
          },
        ],
      },
    ],
  });
  ids.qualification = imported.qualificationId;
  const moduleId = await withTenant(organisationId, async (tx) => {
    const [row] = await tx.select({ id: curriculumModules.id }).from(curriculumModules).where(eq(curriculumModules.qualificationId, imported.qualificationId));
    return row.id;
  });
  const agreement = await createAgreement(admin(), { learnerId: ids.learner, coachId: ids.coach, employerName: "Harbour Kitchen" });
  const logbook = await openLogbook(admin(), agreement.id, moduleId);
  ids.logbook = logbook.id;
  await withPlatformScope("coach staff", (tx) =>
    tx.insert(programmeStaff).values({ organisationId, userId: ids.facilitator, capacity: "facilitator", qualificationId: imported.qualificationId }),
  );
});

afterAll(async () => {
  await withPlatformScope("coach teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

const notified = (userId: string, kind: string) =>
  withPlatformScope("coach notifications", (tx) =>
    // One row per channel: count the in-app ones; each has an email beside it.
    tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.kind, kind), eq(notifications.channel, "in_app"))),
  );

describe("a workplace coach's view of a learner", () => {
  it("lists the coach's own learners with their logbook progress, and drafts the checklist from the work activities", async () => {
    const mine = await coachLearners(coach());
    expect(mine).toMatchObject([{ learnerId: ids.learner, employer: "Harbour Kitchen", logbooks: [{ done: 0, total: 3 }] }]);
    expect(await coachLearners(sessionFor("otherCoach", ["workplace_coach"]))).toEqual([]);

    const view = await coachLearnerView(coach(), ids.learner);
    expect(view?.isCoach).toBe(true);
    expect(view?.activities[0].items).toEqual(["WA0101 Set up the work station.", "WA0102 Check stock against the order."]);
  });

  it("keeps another coach out", async () => {
    expect(await coachLearnerView(sessionFor("otherCoach", ["workplace_coach"]), ids.learner)).toBeNull();
    await expect(
      recordReadiness(sessionFor("otherCoach", ["workplace_coach"]), {
        learnerId: ids.learner,
        ratings: { punctuality: 3, communication: 3, teamwork: 3, safety: 3, applies_skills: 3, initiative: 3 },
        recommendation: "ready",
        comments: "",
      }),
    ).rejects.toThrow(/not this learner's workplace coach/);
  });

  it("signs a checklist, a witness testimony and readiness feedback, which the learner and their facilitator are told about", async () => {
    await recordObservationChecklist(coach(), {
      learnerId: ids.learner,
      logbookId: ids.logbook,
      title: "Morning service",
      observedOn: "2027-05-03",
      items: [
        { label: "WA0101 Set up the work station.", observed: true, comment: "Ready by 07:40." },
        { label: "WA0102 Check stock against the order.", observed: false },
      ],
    });
    await recordWitnessTestimony(coach(), {
      learnerId: ids.learner,
      witnessName: "Thandi Mokoena",
      witnessRole: "Head chef",
      observedOn: "2027-05-04",
      statement: "Prepared the cold section unaided during a full lunch service.",
    });
    await recordReadiness(coach(), {
      learnerId: ids.learner,
      ratings: { punctuality: 4, communication: 3, teamwork: 3, safety: 4, applies_skills: 3, initiative: 2 },
      recommendation: "nearly_ready",
      comments: "Needs more confidence on the line.",
    });

    const view = await coachLearnerView(learner(), ids.learner);
    expect(view?.isCoach).toBe(false);
    expect(view?.records.map((one) => one.kind).sort()).toEqual(["observation_checklist", "readiness_feedback", "witness_testimony"]);
    expect(view?.records.every((one) => one.signedAt)).toBe(true);
    expect(await notified(ids.facilitator, "coach.record")).toHaveLength(3);
    expect(await notified(ids.learner, "coach.record")).toHaveLength(3);
  });

  it("refuses an incomplete readiness form and an empty checklist", async () => {
    await expect(
      recordReadiness(coach(), { learnerId: ids.learner, ratings: { punctuality: 3 }, recommendation: "ready", comments: "" }),
    ).rejects.toThrow(/Rate every item/);
    await expect(
      recordObservationChecklist(coach(), { learnerId: ids.learner, title: "", observedOn: "2027-05-03", items: [{ label: " ", observed: true }] }),
    ).rejects.toThrow(/nothing on it/);
  });

  it("messages the learner's facilitator, and the learner does not see the message", async () => {
    expect(await messageStaff(coach(), { learnerId: ids.learner, body: "Can we meet about the stock checks?" })).toBe(1);
    expect(await notified(ids.facilitator, "coach.message")).toHaveLength(1);
    expect(await notified(ids.learner, "coach.message")).toHaveLength(0);
    const own = await coachLearnerView(learner(), ids.learner);
    expect(own?.records.some((one) => one.kind === "message")).toBe(false);
    const coachSees = await coachLearnerView(coach(), ids.learner);
    expect(coachSees?.records.some((one) => one.kind === "message")).toBe(true);
  });

  it("shows a message to the learner, and tells them, when the coach chooses to", async () => {
    await messageStaff(coach(), { learnerId: ids.learner, body: "Please bring your safety boots on Monday.", shareWithLearner: true });
    expect(await notified(ids.learner, "coach.message")).toHaveLength(1);
    const own = await coachLearnerView(learner(), ids.learner);
    const messages = own?.records.filter((one) => one.kind === "message") ?? [];
    expect(messages.map((one) => one.body)).toEqual(["Please bring your safety boots on Monday."]);
  });
});
