/**
 * A scheduled session is announced to the people expected at it. Job sheet
 * D4, 27 September 2026.
 *
 * Announced a week ahead by the daily sweep, not when entered: a roll-out
 * schedule is thirty-odd lectures entered at once, and thirty messages at
 * once teaches people to ignore them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  cohortMembers,
  cohorts,
  courses,
  notifications,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import { sessionAnnouncement, sweepTenant } from "@/lib/notifications";
import { scheduleSession, setSessionStatus } from "@/lib/scheduling";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
const ids: Record<string, string> = {};
let coordinator: AuthenticatedSession;

// Noon in Johannesburg on Monday 5 October 2026.
const NOW = new Date("2026-10-05T10:00:00Z");

beforeAll(async () => {
  const slug = `sessions-${Date.now()}`;
  await withPlatformScope("sessions fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Session Provider", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;

    for (const [name, role] of [
      ["admin", "tenant_admin"],
      ["facilitator", "instructor"],
      ["learner", "learner"],
      ["gone", "learner"],
    ] as [string, Role][]) {
      const [person] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId, userId: person.id, role });
      ids[name] = person.id;
    }

    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "SU1", status: "published" })
      .returning({ id: courses.id });
    const [cohort] = await tx
      .insert(cohorts)
      .values({ organisationId, courseId: course.id, name: "HRM 01102026", startDate: "2026-10-01", status: "running" })
      .returning({ id: cohorts.id });
    ids.cohort = cohort.id;
    await tx.insert(cohortMembers).values([
      { organisationId, cohortId: cohort.id, userId: ids.learner },
      { organisationId, cohortId: cohort.id, userId: ids.gone, leftAt: new Date("2026-10-02T00:00:00Z") },
    ]);
  });

  coordinator = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: ids.admin,
    organisationId,
    email: "admin@example.test",
    firstName: "A",
    lastName: "Admin",
    roles: ["tenant_admin"],
    permissions: permissionsFor({ roles: ["tenant_admin"] }),
    mustChangePassword: false,
    aiOn: false,
  };

  const soon = await scheduleSession(coordinator, {
    cohortId: ids.cohort,
    title: "Lecture 3: Job analysis",
    scheduledDate: "2026-10-08",
    startTime: "18:30",
    endTime: "20:30",
    deliveryMode: "virtual",
    meetingUrl: "https://meet.example.test/hrm",
    facilitatorId: ids.facilitator,
  });
  const later = await scheduleSession(coordinator, {
    cohortId: ids.cohort,
    title: "Lecture 9",
    scheduledDate: "2026-11-19",
  });
  Object.assign(ids, { soon: soon.id, later: later.id });
});

afterAll(async () => {
  await withPlatformScope("sessions teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function toldAbout(sessionId: string, kind = "session.announced") {
  return withPlatformScope("read notifications", (tx) =>
    tx
      .select({ userId: notifications.userId, subject: notifications.subject, body: notifications.body, channel: notifications.channel })
      .from(notifications)
      .where(and(eq(notifications.entityId, sessionId), eq(notifications.kind, kind))),
  );
}

describe("announcing a session", () => {
  it("says when it is and how to join", () => {
    const words = sessionAnnouncement({
      title: "Lecture 3: Job analysis",
      kind: "lecture",
      cohortName: "HRM 01102026",
      scheduledDate: "2026-10-08",
      startTime: "18:30",
      endTime: "20:30",
      deliveryMode: "virtual",
      meetingUrl: "https://meet.example.test/hrm",
      venue: null,
    });
    expect(words.subject).toBe("Lecture 3: Job analysis, HRM 01102026: Thursday, 8 October 2026, 18:30 to 20:30");
    expect(words.body).toContain("Join online: https://meet.example.test/hrm");
    expect(words.body).not.toMatch(/—/);
  });

  it("tells the cohort and the facilitator a week ahead, by mail and on the platform", async () => {
    await sweepTenant(organisationId, NOW);
    const told = await toldAbout(ids.soon);
    const people = [...new Set(told.map((row) => row.userId))].sort();
    expect(people).toEqual([ids.facilitator, ids.learner].sort());
    expect(told.map((row) => row.channel).sort()).toEqual(["email", "email", "in_app", "in_app"]);
  });

  it("does not tell anybody about a session further off, or somebody who has left", async () => {
    expect(await toldAbout(ids.later)).toEqual([]);
    expect((await toldAbout(ids.soon)).some((row) => row.userId === ids.gone)).toBe(false);
  });

  it("tells them once, however often the sweep runs", async () => {
    await sweepTenant(organisationId, NOW);
    await sweepTenant(organisationId, new Date(NOW.getTime() + 86_400_000));
    expect(await toldAbout(ids.soon)).toHaveLength(4);
  });

  it("tells the same people when it is called off", async () => {
    await setSessionStatus(coordinator, ids.soon, "cancelled", "The facilitator is ill.");
    const off = await toldAbout(ids.soon, "session.cancelled");
    expect([...new Set(off.map((row) => row.userId))].sort()).toEqual([ids.facilitator, ids.learner].sort());
    expect(off[0].subject).toMatch(/^Cancelled: Lecture 3/);
    expect(off[0].body).toContain("The facilitator is ill.");
  });
});
