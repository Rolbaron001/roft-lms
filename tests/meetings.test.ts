/**
 * Live classes in the provider's own Google Meet or Microsoft Teams (job sheet
 * D41, "Connected"; Roland, 29 October 2026).
 *
 * Nothing here calls Google or Microsoft: `fetch` is replaced with a stand-in
 * that answers the way each service's reference says it answers. What is
 * tested is what the platform asks for, what it does with the answer, and
 * what it does when the service refuses.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { cohortMembers, cohortSessions, cohorts, courses, meetingConnections, organisations, userRoles, users } from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";
import { scheduleSession, setSessionMethod } from "@/lib/scheduling";
import { googleMeetProvider } from "@/lib/meetings/google-meet";
import { microsoftTeamsProvider } from "@/lib/meetings/microsoft-teams";
import {
  createMeetingFor,
  disconnectMeetingService,
  ensureMeetings,
  meetingConnectionsFor,
  meetingServiceFor,
  proposeAttendanceFromMeeting,
  recordMeetingConnection,
} from "@/lib/meetings";

const TOKEN = "not-a-real-access-token";
const realFetch = globalThis.fetch;

type Call = { url: string; method: string; body: string | null; authorization: string | null };
let calls: Call[] = [];

/** A stand-in service: each handler answers the requests whose URL it matches. */
function service(handlers: [RegExp, (url: URL, call: Call) => { status?: number; body: unknown }][]) {
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const call: Call = { url: url.toString(), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null, authorization: headers.get("authorization") };
    calls.push(call);
    const handler = handlers.find(([pattern]) => pattern.test(url.toString()));
    const answer = handler ? handler[1](url, call) : { status: 404, body: { error: { message: "not found" } } };
    const status = answer.status ?? 200;
    return { ok: status < 400, status, json: async () => answer.body } as unknown as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
});

// ---------------------------------------------------------------------------
// Google Meet
// ---------------------------------------------------------------------------

describe("Google Meet", () => {
  it("creates a meeting space and returns its link", async () => {
    service([[/\/v2\/spaces$/, () => ({ body: { name: "spaces/abc", meetingUri: "https://meet.google.com/abc-mnop-xyz", meetingCode: "abc-mnop-xyz" } })]]);
    const meeting = await googleMeetProvider.createMeeting({ accessToken: TOKEN, title: "Cohort: lecture", start: new Date(), end: new Date() });
    expect(meeting).toEqual({ externalId: "spaces/abc", joinUrl: "https://meet.google.com/abc-mnop-xyz" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("reads every participant's sessions across pages, one person however often they joined", async () => {
    service([
      [/conferenceRecords\?/, (url) => {
        expect(url.searchParams.get("filter")).toBe('space.name = "spaces/abc"');
        return { body: { conferenceRecords: [{ name: "conferenceRecords/c1", startTime: "2031-03-04T16:00:00Z", endTime: "2031-03-04T18:00:00Z" }] } };
      }],
      [/conferenceRecords\/c1\/participants\?/, (url) =>
        url.searchParams.get("pageToken") === "two"
          ? { body: { participants: [{ name: "conferenceRecords/c1/participants/p3", anonymousUser: { displayName: "Guest Person" } }] } }
          : {
              body: {
                participants: [
                  { name: "conferenceRecords/c1/participants/p1", signedinUser: { user: "users/1", displayName: "Thandi Nkosi" } },
                  { name: "conferenceRecords/c1/participants/p2", signedinUser: { user: "users/1", displayName: "Thandi Nkosi" } },
                ],
                nextPageToken: "two",
              },
            }],
      [/participants\/p1\/participantSessions/, () => ({ body: { participantSessions: [{ name: "s1", startTime: "2031-03-04T16:00:00Z", endTime: "2031-03-04T17:00:00Z" }] } })],
      [/participants\/p2\/participantSessions/, () => ({ body: { participantSessions: [{ name: "s2", startTime: "2031-03-04T17:10:00Z", endTime: "2031-03-04T18:00:00Z" }] } })],
      [/participants\/p3\/participantSessions/, () => ({ body: { participantSessions: [{ name: "s3", startTime: "2031-03-04T16:30:00Z" }] } })],
    ]);
    const attendance = await googleMeetProvider.attendance({ accessToken: TOKEN, externalId: "spaces/abc" });
    expect(attendance.held).toEqual({ startedAt: new Date("2031-03-04T16:00:00Z"), endedAt: new Date("2031-03-04T18:00:00Z") });
    expect(attendance.attendees).toHaveLength(2);
    const thandi = attendance.attendees.find((one) => one.name === "Thandi Nkosi")!;
    expect(thandi.stays).toHaveLength(2);
    expect(thandi.email).toBeNull();
    expect(attendance.attendees.find((one) => one.name === "Guest Person")!.stays[0].leftAt).toBeNull();
  });

  it("asks to connect again when Google refuses the token, and never repeats the secret", async () => {
    const saved = process.env.GOOGLE_MEET_CLIENT_SECRET;
    process.env.GOOGLE_MEET_CLIENT_SECRET = "very-secret-value";
    service([[/oauth2\.googleapis\.com\/token/, () => ({ status: 400, body: { error_description: "bad client very-secret-value" } })]]);
    await expect(googleMeetProvider.refresh("refresh")).rejects.toThrow(/\[secret removed\]/);
    service([[/\/v2\/spaces$/, () => ({ status: 401, body: { error: { message: "expired" } } })]]);
    await expect(googleMeetProvider.createMeeting({ accessToken: TOKEN, title: "x", start: new Date(), end: new Date() })).rejects.toThrow(/Connect Google Meet again/);
    if (saved === undefined) delete process.env.GOOGLE_MEET_CLIENT_SECRET;
    else process.env.GOOGLE_MEET_CLIENT_SECRET = saved;
  });
});

// ---------------------------------------------------------------------------
// Microsoft Teams
// ---------------------------------------------------------------------------

describe("Microsoft Teams", () => {
  it("creates an online meeting with its times and subject", async () => {
    service([[/\/me\/onlineMeetings$/, () => ({ status: 201, body: { id: "MSp1", joinWebUrl: "https://teams.microsoft.com/l/meetup-join/1" } })]]);
    const start = new Date("2031-03-04T16:00:00Z");
    const end = new Date("2031-03-04T18:00:00Z");
    const meeting = await microsoftTeamsProvider.createMeeting({ accessToken: TOKEN, title: "Cohort: lecture", start, end });
    expect(meeting).toEqual({ externalId: "MSp1", joinUrl: "https://teams.microsoft.com/l/meetup-join/1" });
    expect(JSON.parse(calls[0].body!)).toEqual({ startDateTime: start.toISOString(), endDateTime: end.toISOString(), subject: "Cohort: lecture" });
  });

  it("reads every report's records, following the next page, one person across reports", async () => {
    service([
      [/attendanceReports\/r1\/attendanceRecords\?page=2/, () => ({
        body: { value: [{ emailAddress: null, identity: { id: null, displayName: "Phone Caller" }, attendanceIntervals: [{ joinDateTime: "2031-03-04T16:05:00Z", leaveDateTime: "2031-03-04T16:20:00Z" }] }] },
      })],
      [/attendanceReports\/r1\/attendanceRecords$/, (url) => ({
        body: {
          value: [{ emailAddress: "Lerato@Example.org", identity: { id: "u1", displayName: "Lerato Mokoena" }, attendanceIntervals: [{ joinDateTime: "2031-03-04T16:00:00Z", leaveDateTime: "2031-03-04T17:00:00Z" }] }],
          "@odata.nextLink": `${url.toString()}?page=2`,
        },
      })],
      [/attendanceReports\/r2\/attendanceRecords$/, () => ({
        body: { value: [{ emailAddress: "lerato@example.org", identity: { id: "u1", displayName: "Lerato Mokoena" }, attendanceIntervals: [{ joinDateTime: "2031-03-04T17:30:00Z", leaveDateTime: "2031-03-04T18:00:00Z" }] }] },
      })],
      [/onlineMeetings\/MSp1\/attendanceReports$/, () => ({
        body: {
          value: [
            { id: "r1", meetingStartDateTime: "2031-03-04T16:00:00Z", meetingEndDateTime: "2031-03-04T17:00:00Z" },
            { id: "r2", meetingStartDateTime: "2031-03-04T17:30:00Z", meetingEndDateTime: "2031-03-04T18:00:00Z" },
          ],
        },
      })],
    ]);
    const attendance = await microsoftTeamsProvider.attendance({ accessToken: TOKEN, externalId: "MSp1" });
    expect(attendance.held).toEqual({ startedAt: new Date("2031-03-04T16:00:00Z"), endedAt: new Date("2031-03-04T18:00:00Z") });
    const lerato = attendance.attendees.find((one) => one.email === "lerato@example.org")!;
    expect(lerato.stays).toHaveLength(2);
    expect(attendance.attendees.map((one) => one.name).sort()).toEqual(["Lerato Mokoena", "Phone Caller"]);
  });
});

// ---------------------------------------------------------------------------
// Which sessions get a meeting
// ---------------------------------------------------------------------------

describe("which sessions get a meeting", () => {
  it("is an online session held the Meet or Teams way with no link", () => {
    expect(meetingServiceFor("google_meet", { deliveryMode: "virtual", meetingUrl: null })).toBe("google_meet");
    expect(meetingServiceFor("lms_classroom", { deliveryMode: "virtual", meetingUrl: null, liveClassMethod: "microsoft_teams" })).toBe("microsoft_teams");
    expect(meetingServiceFor("google_meet", { deliveryMode: "in_person", meetingUrl: null })).toBeNull();
    expect(meetingServiceFor("google_meet", { deliveryMode: "virtual", meetingUrl: "https://meet.example/x" })).toBeNull();
    expect(meetingServiceFor("google_meet", { deliveryMode: "virtual", meetingUrl: null, liveClassMethod: "meeting_link" })).toBeNull();
    expect(meetingServiceFor("meeting_link", { deliveryMode: "virtual", meetingUrl: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The connection, creating meetings, and reading attendance, against the database
// ---------------------------------------------------------------------------

const DAY = "2031-05-06";

type Provider = { organisationId: string; admin: AuthenticatedSession; cohortId: string; learners: string[] };
let alpha: Provider;
let beta: Provider;

function sessionFor(organisationId: string, roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@meetings.test",
    firstName: "Test",
    lastName: "Admin",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function provider(slug: string): Promise<Provider> {
  return withPlatformScope("meetings test fixture", async (tx) => {
    const [org] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: slug, status: "active", liveClassMethod: "google_meet", classroomPresentPercent: 75 })
      .returning({ id: organisations.id });
    const [admin] = await tx
      .insert(users)
      .values({ organisationId: org.id, email: `admin@${slug}.test`, firstName: "Admin", lastName: slug, status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: org.id, userId: admin.id, role: "tenant_admin" });
    const [course] = await tx.insert(courses).values({ organisationId: org.id, title: "SU1", status: "published" }).returning({ id: courses.id });
    const [cohort] = await tx
      .insert(cohorts)
      .values({ organisationId: org.id, courseId: course.id, name: `${slug} cohort`, startDate: "2031-01-01", status: "running" })
      .returning({ id: cohorts.id });
    const learners: string[] = [];
    for (const [first, last] of [["Thandi", "Nkosi"], ["Sipho", "Dlamini"], ["Anna", "Botha"]]) {
      const [learner] = await tx
        .insert(users)
        .values({ organisationId: org.id, email: `${first.toLowerCase()}@${slug}.test`, firstName: first, lastName: last, status: "active" })
        .returning({ id: users.id });
      await tx.insert(cohortMembers).values({ organisationId: org.id, cohortId: cohort.id, userId: learner.id });
      learners.push(learner.id);
    }
    return { organisationId: org.id, admin: sessionFor(org.id, ["tenant_admin"], admin.id), cohortId: cohort.id, learners };
  });
}

const created = { body: { name: "spaces/made", meetingUri: "https://meet.google.com/made-link-abc" } };

function sessionRow(organisationId: string, id: string) {
  return withTenant(organisationId, async (tx) => {
    const [row] = await tx
      .select({ meetingUrl: cohortSessions.meetingUrl, service: cohortSessions.meetingService, externalId: cohortSessions.meetingExternalId })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, id));
    return row;
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  alpha = await provider(`meetings-a-${stamp}`);
  beta = await provider(`meetings-b-${stamp}`);
  await recordMeetingConnection(alpha.admin, "google_meet", { refreshToken: "refresh-a", accessToken: TOKEN, expiresIn: 3600, accountLabel: "classes@alpha.test" });
});

afterAll(async () => {
  await withPlatformScope("meetings test teardown", async (tx) => {
    for (const one of [alpha, beta]) if (one) await tx.delete(organisations).where(eq(organisations.id, one.organisationId));
  });
});

describe("the provider's connected account", () => {
  it("is the provider's own, shown by its name and never by a token", async () => {
    const mine = await meetingConnectionsFor(alpha.admin);
    expect(mine.find((one) => one.service === "google_meet")).toMatchObject({ accountLabel: "classes@alpha.test" });
    expect(JSON.stringify(mine)).not.toContain(TOKEN);
    const theirs = await meetingConnectionsFor(beta.admin);
    expect(theirs.every((one) => one.connectedAt === null)).toBe(true);
    const [stored] = await withTenant(alpha.organisationId, (tx) => tx.select().from(meetingConnections));
    expect(stored.refreshTokenSealed).not.toContain("refresh-a");
  });

  it("needs the settings permission to connect", async () => {
    const facilitator = sessionFor(alpha.organisationId, ["instructor"], alpha.admin.userId);
    await expect(recordMeetingConnection(facilitator, "google_meet", { refreshToken: "r", accessToken: "a", expiresIn: 60, accountLabel: null })).rejects.toThrow();
  });
});

describe("creating the meeting", () => {
  it("creates it in the connected account and puts its link on the session", async () => {
    service([[/\/v2\/spaces$/, () => created]]);
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "18:00", endTime: "20:00", deliveryMode: "virtual" });
    expect(await createMeetingFor(alpha.organisationId, session.id)).toEqual({ kind: "created", service: "google_meet" });
    expect(await sessionRow(alpha.organisationId, session.id)).toEqual({ meetingUrl: "https://meet.google.com/made-link-abc", service: "google_meet", externalId: "spaces/made" });
    // Once made, it is not made again.
    expect(await createMeetingFor(alpha.organisationId, session.id)).toEqual({ kind: "not_needed" });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("leaves a session alone that is in person, has a pasted link, or is held another way", async () => {
    service([[/\/v2\/spaces$/, () => created]]);
    for (const extra of [{ deliveryMode: "in_person" as const }, { meetingUrl: "https://zoom.example/j/1" }, { liveClassMethod: "meeting_link" as const }]) {
      const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "09:00", deliveryMode: "virtual", ...extra });
      expect(await createMeetingFor(alpha.organisationId, session.id)).toEqual({ kind: "not_needed" });
    }
    expect(calls).toHaveLength(0);
  });

  it("says so when the service is not connected", async () => {
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "10:00", deliveryMode: "virtual", liveClassMethod: "microsoft_teams" });
    expect(await createMeetingFor(alpha.organisationId, session.id)).toEqual({ kind: "not_connected", service: "microsoft_teams" });
  });

  it("keeps the session when the service refuses, and says why", async () => {
    service([[/\/v2\/spaces$/, () => ({ status: 403, body: { error: { message: "Meet is off for this account" } } })]]);
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "11:00", deliveryMode: "virtual" });
    const outcome = await createMeetingFor(alpha.organisationId, session.id);
    expect(outcome).toMatchObject({ kind: "failed", service: "google_meet" });
    expect(outcome.kind === "failed" && outcome.message).toMatch(/Meet is off for this account/);
    expect(await sessionRow(alpha.organisationId, session.id)).toEqual({ meetingUrl: null, service: null, externalId: null });
  });

  it("forgets the created meeting when the session's link is changed, and keeps it when not", async () => {
    service([[/\/v2\/spaces$/, () => created]]);
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "12:00", endTime: "13:00", deliveryMode: "virtual" });
    await createMeetingFor(alpha.organisationId, session.id);
    await setSessionMethod(alpha.admin, session.id, { method: null, meetingUrl: "https://meet.google.com/made-link-abc" });
    expect((await sessionRow(alpha.organisationId, session.id)).service).toBe("google_meet");
    await setSessionMethod(alpha.admin, session.id, { method: "meeting_link", meetingUrl: "https://zoom.example/j/2" });
    expect(await sessionRow(alpha.organisationId, session.id)).toEqual({ meetingUrl: "https://zoom.example/j/2", service: null, externalId: null });
  });

  it("creates the coming week's missing meetings in the daily run, and none further ahead", async () => {
    const now = new Date();
    const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    service([[/\/v2\/spaces$/, () => ({ status: 500, body: { error: { message: "down" } } })]]);
    const soon = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: inDays(3), startTime: "18:00", deliveryMode: "virtual" });
    const later = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: inDays(30), startTime: "18:00", deliveryMode: "virtual" });
    service([[/\/v2\/spaces$/, () => created]]);
    const result = await ensureMeetings(alpha.organisationId, now);
    expect(result.created).toBeGreaterThanOrEqual(1);
    expect((await sessionRow(alpha.organisationId, soon.id)).service).toBe("google_meet");
    expect((await sessionRow(alpha.organisationId, later.id)).meetingUrl).toBeNull();
    // A provider with nothing connected is not asked about at all.
    calls = [];
    expect(await ensureMeetings(beta.organisationId, now)).toEqual({ created: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("reading attendance from the meeting", () => {
  it("marks learners by their share of the class and lists anyone it cannot match", async () => {
    service([[/\/v2\/spaces$/, () => created]]);
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "18:00", endTime: "20:00", deliveryMode: "virtual" });
    await createMeetingFor(alpha.organisationId, session.id);

    service([
      [/conferenceRecords\?/, () => ({ body: { conferenceRecords: [{ name: "conferenceRecords/m1", startTime: "2031-05-06T16:00:00Z", endTime: "2031-05-06T18:00:00Z" }] } })],
      [/m1\/participants\?/, () => ({
        body: {
          participants: [
            { name: "conferenceRecords/m1/participants/a", signedinUser: { user: "users/a", displayName: "THANDI NKOSI" } },
            { name: "conferenceRecords/m1/participants/b", anonymousUser: { displayName: "Dlamini, Sipho" } },
            { name: "conferenceRecords/m1/participants/c", anonymousUser: { displayName: "Someone Else" } },
          ],
        },
      })],
      // Thandi: 100 of 120 minutes. Sipho: 30 of 120. Anna: not there.
      [/participants\/a\/participantSessions/, () => ({ body: { participantSessions: [{ name: "1", startTime: "2031-05-06T16:00:00Z", endTime: "2031-05-06T17:40:00Z" }] } })],
      [/participants\/b\/participantSessions/, () => ({ body: { participantSessions: [{ name: "2", startTime: "2031-05-06T16:00:00Z", endTime: "2031-05-06T16:30:00Z" }] } })],
      [/participants\/c\/participantSessions/, () => ({ body: { participantSessions: [{ name: "3", startTime: "2031-05-06T16:00:00Z", endTime: "2031-05-06T18:00:00Z" }] } })],
    ]);

    const proposal = await proposeAttendanceFromMeeting(alpha.admin, session.id);
    const [thandi, sipho, anna] = alpha.learners.map((id) => proposal.marks.find((mark) => mark.userId === id)!);
    expect(thandi).toMatchObject({ status: "present", note: "In the call 100 min" });
    expect(sipho).toMatchObject({ status: "absent", note: "In the call 30 of 120 min, below 75%" });
    expect(anna).toMatchObject({ status: "absent", note: "" });
    expect(proposal.unknown).toEqual(["Someone Else"]);
    expect(proposal.read).toBe(3);
  });

  it("refuses a session whose meeting the LMS did not create", async () => {
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "07:00", deliveryMode: "virtual", meetingUrl: "https://meet.google.com/pasted" });
    await expect(proposeAttendanceFromMeeting(alpha.admin, session.id)).rejects.toThrow(/Upload the meeting's attendance export instead/);
  });

  it("says when the service has no attendance yet", async () => {
    service([[/\/v2\/spaces$/, () => created]]);
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "21:00", deliveryMode: "virtual" });
    await createMeetingFor(alpha.organisationId, session.id);
    service([[/conferenceRecords\?/, () => ({ body: {} })]]);
    await expect(proposeAttendanceFromMeeting(alpha.admin, session.id)).rejects.toThrow(/no attendance for this meeting yet/);
  });
});

describe("disconnecting", () => {
  it("forgets the account; meetings already made keep their links", async () => {
    await disconnectMeetingService(alpha.admin, "google_meet");
    expect((await meetingConnectionsFor(alpha.admin)).every((one) => one.connectedAt === null)).toBe(true);
    const session = await scheduleSession(alpha.admin, { cohortId: alpha.cohortId, scheduledDate: DAY, startTime: "22:00", deliveryMode: "virtual" });
    expect(await createMeetingFor(alpha.organisationId, session.id)).toEqual({ kind: "not_connected", service: "google_meet" });
  });
});
