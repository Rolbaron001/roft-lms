/**
 * The LMS classroom (job sheet D41, phase A).
 *
 * The arithmetic and the calendar invitation on their own first, then the
 * classroom against a live database: who may come in, the lobby, the register
 * filled in from the media server's reports, and the reminders.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  cohortMembers,
  cohortSessions,
  cohorts,
  courses,
  mailMessages,
  notifications,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import { classLength, markFor, minutesIn } from "@/lib/classroom-attendance";
import { classInvitation } from "@/lib/classroom-calendar";
import { heldInClassroom, joinHref } from "@/lib/classroom-rules";
import { classPass, classroomState, endClass, getClassroom, postClassChat, recordPresence, saveClassNotes } from "@/lib/classroom";
import { classReminders, calendarFor } from "@/lib/classroom-reminders";
import { sweepTenant } from "@/lib/notifications";
import { takeRegister, sessionRegister } from "@/lib/scheduling";
import { roomName } from "@/lib/classroom-media";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

const at = (clock: string) => new Date(`2026-11-02T${clock}:00Z`);

describe("time in the class", () => {
  it("adds up every stay and counts overlapping time once", () => {
    const stays = [
      { joinedAt: at("16:00"), leftAt: at("16:40") },
      // A second tab, overlapping the first.
      { joinedAt: at("16:30"), leftAt: at("16:50") },
      // Back after a dropped connection, and still in when the class ended.
      { joinedAt: at("17:10"), leftAt: null },
    ];
    expect(minutesIn(stays, at("16:00"), at("18:00"))).toBe(50 + 50);
  });

  it("counts only the time the class was open", () => {
    expect(minutesIn([{ joinedAt: at("15:40"), leftAt: at("16:20") }], at("16:00"), at("18:00"))).toBe(20);
  });

  it("measures against the scheduled length, or the class as held if shorter", () => {
    const scheduled = { startTime: "18:00", endTime: "20:00" };
    expect(classLength(scheduled, { startedAt: at("16:00"), endedAt: at("18:30") })).toBe(120);
    expect(classLength(scheduled, { startedAt: at("16:00"), endedAt: at("17:30") })).toBe(90);
    expect(classLength({ startTime: null, endTime: null }, { startedAt: at("16:00"), endedAt: at("17:00") })).toBe(60);
  });

  it("is present at the provider's share or more, absent below it", () => {
    expect(markFor(90, 120, 75)).toBe("present");
    expect(markFor(89, 120, 75)).toBe("absent");
    expect(markFor(0, 0, 75)).toBe("absent");
  });
});

describe("the calendar invitation", () => {
  const invite = {
    sessionId: "11111111-2222-3333-4444-555555555555",
    domain: "lms.example.test",
    method: "REQUEST" as const,
    start: at("16:30"),
    end: at("18:30"),
    summary: "Lecture 3, HRM Officer 2026, Monday, 2 November 2026",
    description: "Lecture 3 for HRM Officer 2026; bring your workbook.",
    url: "https://lms.example.test/classroom/11111111-2222-3333-4444-555555555555",
    organiser: { name: "Curiosa Academy", email: "lms@example.test" },
    attendee: { name: "Thandi", email: "thandi@example.test" },
  };

  it("names the session, so a cancellation finds the entry it cancels", () => {
    const text = classInvitation(invite, at("08:00"));
    expect(text).toContain("METHOD:REQUEST");
    expect(text).toContain("UID:class-11111111-2222-3333-4444-555555555555@lms.example.test");
    expect(text).toContain("DTSTART:20261102T163000Z");
    expect(text).toContain("STATUS:CONFIRMED");
    expect(text).toContain("SUMMARY:Lecture 3\\, HRM Officer 2026\\, Monday\\, 2 November 2026");

    const cancel = classInvitation({ ...invite, method: "CANCEL" }, at("08:00"));
    expect(cancel).toContain("METHOD:CANCEL");
    expect(cancel).toContain("SEQUENCE:1");
    expect(cancel).toContain("STATUS:CANCELLED");
  });

  it("keeps every line within what calendar programs accept", () => {
    const text = classInvitation({ ...invite, description: "A long description. ".repeat(20) }, at("08:00"));
    for (const line of text.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("which sessions the classroom holds", () => {
  it("holds online sessions without an outside link, once switched on", () => {
    expect(heldInClassroom(true, { deliveryMode: "virtual", meetingUrl: null })).toBe(true);
    expect(heldInClassroom(true, { deliveryMode: "virtual", meetingUrl: "https://meet.google.com/abc" })).toBe(false);
    expect(heldInClassroom(true, { deliveryMode: "in_person", meetingUrl: null })).toBe(false);
    expect(heldInClassroom(false, { deliveryMode: "virtual", meetingUrl: null })).toBe(false);
  });

  it("joins at the outside link where there is one, the classroom otherwise", () => {
    expect(joinHref(true, { id: "s", deliveryMode: "virtual", meetingUrl: null })).toEqual({ href: "/classroom/s", external: false });
    expect(joinHref(true, { id: "s", deliveryMode: "virtual", meetingUrl: "https://meet.example" })).toEqual({ href: "https://meet.example", external: true });
    expect(joinHref(true, { id: "s", deliveryMode: "in_person", meetingUrl: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------

let organisationId: string;
let otherOrganisationId: string;
let cohortId: string;
let sessionId: string;
let facilitator: AuthenticatedSession;
let learner: AuthenticatedSession;
let excusedLearner: AuthenticatedSession;
let absentLearner: AuthenticatedSession;
let outsider: AuthenticatedSession;
let stranger: AuthenticatedSession;

const saved = {
  url: process.env.LIVEKIT_URL,
  key: process.env.LIVEKIT_API_KEY,
  secret: process.env.LIVEKIT_API_SECRET,
  from: process.env.MAIL_FROM,
};

function sessionFor(org: string, roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId: org,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function person(org: string, email: string, role: Role, mailbox = false): Promise<AuthenticatedSession> {
  const id = await withPlatformScope("classroom test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ organisationId: org, email, firstName: email.split("@")[0], lastName: "Tester", status: "active", mailboxAddress: mailbox ? email.replace("@", ".box@") : null })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: org, userId: user.id, role });
    return user.id;
  });
  return sessionFor(org, [role], id);
}

beforeAll(async () => {
  // A media server is named but never reached: passes are signed locally.
  process.env.LIVEKIT_URL = "ws://127.0.0.1:9";
  process.env.LIVEKIT_API_KEY = "testkey";
  process.env.LIVEKIT_API_SECRET = "a-test-secret-that-is-long-enough-to-sign-with";
  process.env.MAIL_FROM = "Classroom Test <lms@example.test>";

  const stamp = Date.now();
  [organisationId, otherOrganisationId] = await withPlatformScope("classroom test setup", async (tx) => {
    const rows = await tx
      .insert(organisations)
      .values([
        { slug: `classroom-${stamp}`, legalName: "Classroom Test Ltd", displayName: "Classroom Test Co", status: "active", classroomEnabled: true },
        { slug: `classroom-other-${stamp}`, legalName: "Other Ltd", displayName: "Other Co", status: "active", classroomEnabled: true },
      ])
      .returning({ id: organisations.id });
    return rows.map((row) => row.id);
  });

  facilitator = await person(organisationId, `facilitator-${stamp}@classroom.test`, "instructor");
  learner = await person(organisationId, `learner-${stamp}@classroom.test`, "learner", true);
  excusedLearner = await person(organisationId, `excused-${stamp}@classroom.test`, "learner");
  absentLearner = await person(organisationId, `absent-${stamp}@classroom.test`, "learner");
  outsider = await person(organisationId, `outsider-${stamp}@classroom.test`, "learner");
  stranger = await person(otherOrganisationId, `stranger-${stamp}@classroom.test`, "tenant_admin");

  ({ cohortId, sessionId } = await withPlatformScope("classroom test cohort", async (tx) => {
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published" }).returning({ id: courses.id });
    const [cohort] = await tx
      .insert(cohorts)
      .values({ organisationId, courseId: course.id, name: "HRM Officer 2026", startDate: "2026-10-01", status: "running" })
      .returning({ id: cohorts.id });
    await tx.insert(cohortMembers).values([learner, excusedLearner, absentLearner].map((one) => ({ organisationId, cohortId: cohort.id, userId: one.userId })));
    const [session] = await tx
      .insert(cohortSessions)
      .values({ organisationId, cohortId: cohort.id, kind: "lecture", sequence: 3, scheduledDate: "2026-11-02", startTime: "18:30", endTime: "20:30", deliveryMode: "virtual", facilitatorId: facilitator.userId })
      .returning({ id: cohortSessions.id });
    return { cohortId: cohort.id, sessionId: session.id };
  }));
});

afterAll(async () => {
  process.env.LIVEKIT_URL = saved.url;
  process.env.LIVEKIT_API_KEY = saved.key;
  process.env.LIVEKIT_API_SECRET = saved.secret;
  process.env.MAIL_FROM = saved.from;
  await withPlatformScope("classroom test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
  await withPlatformScope("classroom test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, otherOrganisationId)),
  );
});

// 18:30 in Johannesburg is 16:30 UTC.
const beforeLobby = at("16:00");
const inLobby = at("16:20");

describe("who may come in", () => {
  it("lets the cohort's learners and its facilitator in, and nobody else", async () => {
    expect((await getClassroom(learner, sessionId, inLobby)).role).toBe("learner");
    expect((await getClassroom(facilitator, sessionId, inLobby)).role).toBe("host");
    await expect(getClassroom(outsider, sessionId, inLobby)).rejects.toThrow(/cohort's learners and its staff/);
    // Another provider's administrator does not even find it.
    await expect(getClassroom(stranger, sessionId, inLobby)).rejects.toThrow(/not found/);
  });

  it("keeps a learner out until fifteen minutes before, then in the lobby until it is opened", async () => {
    expect(await classroomState(learner, sessionId, beforeLobby)).toBe("early");
    expect(await classroomState(learner, sessionId, inLobby)).toBe("lobby");
    expect(await classPass(learner, sessionId, inLobby)).toEqual({ waiting: "lobby" });
  });

  it("opens the class when its facilitator comes in, and lets the learners in after", async () => {
    const host = await classPass(facilitator, sessionId, at("16:25"));
    expect("token" in host && host.role).toBe("host");
    const pass = await classPass(learner, sessionId, at("16:26"));
    expect("token" in pass && pass.role).toBe("learner");
    if ("token" in pass) {
      // The pass names this person and this class's room, and nothing more.
      const claims = JSON.parse(Buffer.from(pass.token.split(".")[1], "base64url").toString());
      expect(claims.sub).toBe(learner.userId);
      expect(claims.video.room).toBe(roomName(organisationId, sessionId));
      expect(claims.video.roomAdmin).toBe(false);
      expect(claims.video.canPublishSources).not.toContain("screen_share");
    }
  });

  it("keeps the chat with the class and the notes for the facilitator alone", async () => {
    await postClassChat(learner, sessionId, "Good evening");
    await saveClassNotes(facilitator, sessionId, "Covered job architecture.");
    await expect(saveClassNotes(learner, sessionId, "Mine")).rejects.toThrow(/facilitator/);
    const seen = await getClassroom(learner, sessionId);
    expect(seen.chat.map((line) => line.body)).toContain("Good evening");
    expect(seen.notes).toBeNull();
    expect((await getClassroom(facilitator, sessionId)).notes).toBe("Covered job architecture.");
  });
});

describe("the register, from who was there", () => {
  it("marks present at the share or more, leaves a person's own marks alone, and asks the facilitator to check", async () => {
    const room = roomName(organisationId, sessionId);
    // The learner stays the whole class, dropping once; the absent one looks in briefly.
    await recordPresence({ event: "joined", room, identity: learner.userId, connectionId: "PA_1", at: at("16:26") });
    await recordPresence({ event: "left", room, identity: learner.userId, connectionId: "PA_1", at: at("17:10") });
    await recordPresence({ event: "joined", room, identity: learner.userId, connectionId: "PA_2", at: at("17:12") });
    await recordPresence({ event: "joined", room, identity: absentLearner.userId, connectionId: "PA_3", at: at("16:40") });
    await recordPresence({ event: "left", room, identity: absentLearner.userId, connectionId: "PA_3", at: at("17:00") });
    // A report about some other provider's room, or a made-up person, changes nothing.
    expect(await recordPresence({ event: "joined", room: "elsewhere-room", identity: learner.userId, connectionId: "X", at: at("16:30") })).toBe(false);

    // Excused before the class by a person, which the classroom must not overturn.
    await takeRegister(facilitator, sessionId, [{ userId: excusedLearner.userId, status: "excused", note: "Medical note" }]);

    const tally = await endClass(facilitator, sessionId, at("18:30"));
    expect(tally).toEqual({ present: 1, absent: 1 });

    const register = await sessionRegister(facilitator, sessionId);
    const line = (who: AuthenticatedSession) => register.lines.find((one) => one.userId === who.userId)!;
    expect(line(learner)).toMatchObject({ status: "present", fromClassroom: true });
    expect(line(learner).note).toMatch(/In the class 1\d\d of 120 minutes/);
    expect(line(absentLearner)).toMatchObject({ status: "absent", fromClassroom: true });
    expect(line(excusedLearner)).toMatchObject({ status: "excused", fromClassroom: false });

    const [held] = await withTenant(organisationId, (tx) => tx.select({ status: cohortSessions.status }).from(cohortSessions).where(eq(cohortSessions.id, sessionId)));
    expect(held.status).toBe("completed");
    const asked = await withTenant(organisationId, (tx) =>
      tx.select().from(notifications).where(and(eq(notifications.entityId, sessionId), eq(notifications.kind, "class.register_to_check"))),
    );
    expect(asked.map((row) => row.userId)).toEqual([facilitator.userId]);

    // Saving the register is the facilitator confirming it.
    await takeRegister(facilitator, sessionId, register.lines.map((one) => ({ userId: one.userId, status: one.status!, note: one.note ?? undefined })));
    expect((await sessionRegister(facilitator, sessionId)).lines.some((one) => one.fromClassroom)).toBe(false);
    expect(await classroomState(learner, sessionId)).toBe("ended");
  });
});

describe("reminders", () => {
  let nextSession: string;

  beforeAll(async () => {
    nextSession = await withPlatformScope("classroom test next class", async (tx) => {
      const [row] = await tx
        .insert(cohortSessions)
        .values({ organisationId, cohortId, kind: "lecture", sequence: 4, scheduledDate: "2026-11-09", startTime: "18:30", endTime: "20:30", deliveryMode: "virtual", facilitatorId: facilitator.userId })
        .returning({ id: cohortSessions.id });
      return row.id;
    });
  });

  const told = (kind: string) =>
    withTenant(organisationId, (tx) =>
      tx.select({ userId: notifications.userId, channel: notifications.channel, dedupeKey: notifications.dedupeKey }).from(notifications).where(and(eq(notifications.entityId, nextSession), eq(notifications.kind, kind))),
    );

  it("announces a class a week ahead to its learners and facilitator, once, and files it in the LMS mailbox", async () => {
    const weekBefore = new Date("2026-11-03T09:00:00Z");
    await classReminders(organisationId, weekBefore);
    await classReminders(organisationId, weekBefore);
    const inApp = (await told("session.announced")).filter((row) => row.channel === "in_app");
    expect(inApp.map((row) => row.userId).sort()).toEqual([learner.userId, excusedLearner.userId, absentLearner.userId, facilitator.userId].sort());

    const filed = await withTenant(organisationId, (tx) => tx.select().from(mailMessages).where(eq(mailMessages.mailboxUserId, learner.userId)));
    expect(filed).toHaveLength(1);
    expect(filed[0].bodyText).toContain(`/classroom/${nextSession}`);

    // The general sweep leaves classroom classes to the classroom.
    await sweepTenant(organisationId, weekBefore);
    expect((await told("session.announced")).filter((row) => row.channel === "in_app")).toHaveLength(4);
  });

  it("reminds the day before and fifteen minutes before", async () => {
    await classReminders(organisationId, new Date("2026-11-08T17:00:00Z"));
    await classReminders(organisationId, new Date("2026-11-09T16:20:00Z"));
    const keys = (await told("class.reminder")).filter((row) => row.userId === learner.userId && row.channel === "in_app").map((row) => row.dedupeKey.split(":")[0]);
    expect(keys.sort()).toEqual(["class_day", "class_soon"]);
  });

  it("carries a calendar invitation with the week-ahead email", async () => {
    const calendar = await calendarFor({ organisationId, kind: "session.announced", entityType: "cohort_session", entityId: nextSession, email: "learner@example.test", firstName: "Thandi" });
    expect(calendar?.method).toBe("REQUEST");
    expect(calendar?.content).toContain("DTSTART:20261109T163000Z");
    expect(calendar?.content).toContain(`/classroom/${nextSession}`);
    expect(await calendarFor({ organisationId, kind: "class.reminder", entityType: "cohort_session", entityId: nextSession, email: "x@example.test", firstName: "X" })).toBeNull();
  });
});
