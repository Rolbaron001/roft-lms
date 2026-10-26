/**
 * The record of a class (job sheet D41, phase B): the transcription notice,
 * each voice recorded, the class sent to be transcribed once every recording
 * has closed, the transcript filed, corrected and published, and the voices
 * deleted. The media server and the transcriber are stood in for; what is
 * checked is what the LMS asks of them and what it keeps.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { classroomRecordings, classroomRecords, cohortMembers, cohortSessions, cohorts, courses, notifications, organisations, userRoles, users } from "@/db/schema";
import { orderTranscript, transcriptText } from "@/lib/classroom-transcript";
import { classPass, endClass } from "@/lib/classroom";
import { acknowledgeNotice, noticeOwed } from "@/lib/classroom-notice";
import {
  classNotes,
  cohortClassNotes,
  correctTranscript,
  draftSummary,
  getClassRecord,
  microphoneStarted,
  myClassNotes,
  publishRecord,
  receiveTranscript,
  recordingEnded,
  saveSummary,
  transcribeWhenReady,
} from "@/lib/classroom-record";
import { roomName } from "@/lib/classroom-media";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

vi.mock("@/lib/classroom-media", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/classroom-media")>();
  return {
    ...real,
    startVoiceRecording: vi.fn(async (room: string, trackId: string, identity: string) => ({ egressId: `EG_${trackId}`, filePath: `/recordings/${room}/${identity}-${trackId}.ogg` })),
    closeRoom: vi.fn(async () => {}),
    sendToRoom: vi.fn(async () => {}),
  };
});

describe("the transcript, put together", () => {
  it("reads in the order things were said, whoever said them", () => {
    const ordered = orderTranscript([
      { userId: "a", startedAt: "2026-11-02T16:31:00Z", endedAt: "", text: "second" },
      { userId: "b", startedAt: "2026-11-02T16:30:00Z", endedAt: "", text: "first" },
      { userId: "a", startedAt: "2026-11-02T16:32:00Z", endedAt: "", text: "third" },
    ]);
    expect(ordered.map((line) => line.text)).toEqual(["first", "second", "third"]);
  });

  it("joins one person's consecutive lines into a turn", () => {
    expect(transcriptText([{ name: "Thandi", text: "Good evening." }, { name: "Thandi", text: "Open SU1." }, { name: "Sam", text: "Ready." }])).toBe(
      "Thandi: Good evening. Open SU1.\nSam: Ready.",
    );
  });
});

let organisationId: string;
let cohortId: string;
let sessionId: string;
let facilitator: AuthenticatedSession;
let learner: AuthenticatedSession;
const asked: { url: string; method: string; body: unknown }[] = [];
const saved = { ...process.env };

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return { sessionId: "00000000-0000-0000-0000-000000000000", userId, organisationId, email: "t@example.test", firstName: "T", lastName: "U", roles, permissions: permissionsFor({ roles }), mustChangePassword: false, aiOn: false };
}

async function person(email: string, role: Role, firstName: string): Promise<AuthenticatedSession> {
  const id = await withPlatformScope("classroom record fixture", async (tx) => {
    const [user] = await tx.insert(users).values({ organisationId, email, firstName, lastName: "Tester", status: "active" }).returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
    return user.id;
  });
  return sessionFor([role], id);
}

beforeAll(async () => {
  process.env.LIVEKIT_URL = "ws://127.0.0.1:9";
  process.env.LIVEKIT_API_KEY = "testkey";
  process.env.LIVEKIT_API_SECRET = "a-test-secret-that-is-long-enough-to-sign-with";
  process.env.TRANSCRIBER_URL = "http://transcriber.test:8790";
  process.env.TRANSCRIBER_SECRET = "test-transcriber-secret";
  process.env.AUTH_URL = "https://lms.example.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response("{}", { status: 202 });
    }),
  );

  const stamp = Date.now();
  organisationId = await withPlatformScope("classroom record setup", async (tx) => {
    const [row] = await tx
      .insert(organisations)
      .values({ slug: `record-${stamp}`, legalName: "Record Ltd", displayName: "Record Co", status: "active", classroomEnabled: true, classroomTranscribe: true })
      .returning({ id: organisations.id });
    return row.id;
  });
  facilitator = await person(`facilitator-${stamp}@record.test`, "instructor", "Thandi");
  learner = await person(`learner-${stamp}@record.test`, "learner", "Sam");
  ({ cohortId, sessionId } = await withPlatformScope("classroom record cohort", async (tx) => {
    const [course] = await tx.insert(courses).values({ organisationId, title: "SU1", status: "published" }).returning({ id: courses.id });
    const [cohort] = await tx.insert(cohorts).values({ organisationId, courseId: course.id, name: "HRM 2026", startDate: "2026-10-01", status: "running" }).returning({ id: cohorts.id });
    await tx.insert(cohortMembers).values({ organisationId, cohortId: cohort.id, userId: learner.userId });
    const [session] = await tx
      .insert(cohortSessions)
      .values({ organisationId, cohortId: cohort.id, kind: "lecture", scheduledDate: "2026-11-02", startTime: "18:30", endTime: "20:30", deliveryMode: "virtual", facilitatorId: facilitator.userId })
      .returning({ id: cohortSessions.id });
    return { cohortId: cohort.id, sessionId: session.id };
  }));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TRANSCRIBER_URL", "TRANSCRIBER_SECRET", "AUTH_URL"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await withPlatformScope("classroom record teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

const at = (clock: string) => new Date(`2026-11-02T${clock}:00Z`);

describe("the notice", () => {
  it("keeps everybody out of a transcribed class until they have acknowledged it, once", async () => {
    expect(await noticeOwed(learner)).toBe(true);
    expect(await classPass(facilitator, sessionId, at("16:25"))).toEqual({ notice: true });
    await acknowledgeNotice(facilitator);
    await acknowledgeNotice(facilitator);
    const opened = await classPass(facilitator, sessionId, at("16:25"));
    expect("token" in opened).toBe(true);
    await acknowledgeNotice(learner);
    expect(await noticeOwed(learner)).toBe(false);
  });
});

describe("the record of a class", () => {
  const room = () => roomName(organisationId, sessionId);

  it("records each microphone, and waits for every recording to close before asking for the transcript", async () => {
    expect(await microphoneStarted({ room: room(), identity: facilitator.userId, trackId: "TR_host", at: at("16:30") })).toBe(true);
    expect(await microphoneStarted({ room: room(), identity: learner.userId, trackId: "TR_learner", at: at("16:40") })).toBe(true);
    // Somebody unknown, or another provider's room, is not recorded.
    expect(await microphoneStarted({ room: "elsewhere", identity: learner.userId, trackId: "TR_x", at: at("16:41") })).toBe(false);

    await endClass(facilitator, sessionId, at("18:30"));
    expect(await transcribeWhenReady(organisationId, sessionId)).toBe("waiting");
    expect(asked.filter((one) => one.url.endsWith("/jobs"))).toHaveLength(0);

    await recordingEnded({ egressId: "EG_TR_host", at: at("18:30"), failed: false });
    expect(asked.filter((one) => one.url.endsWith("/jobs"))).toHaveLength(0);
    await recordingEnded({ egressId: "EG_TR_learner", at: at("18:30"), failed: false });

    const jobs = asked.filter((one) => one.url.endsWith("/jobs"));
    expect(jobs).toHaveLength(1);
    const job = jobs[0].body as { job: string; callback: string; files: { speaker: string; startedAt: string }[] };
    expect(job.job).toBe(`${organisationId}/${sessionId}`);
    expect(job.callback).toBe("https://lms.example.test/api/classroom/transcript");
    expect(job.files.map((one) => one.speaker).sort()).toEqual([facilitator.userId, learner.userId].sort());

    // A second report afterwards sends nothing more.
    await transcribeWhenReady(organisationId, sessionId);
    expect(asked.filter((one) => one.url.endsWith("/jobs"))).toHaveLength(1);
    expect((await getClassRecord(facilitator, sessionId)).canPublish).toBe(false);
  });

  it("files the transcript in the order it was said, drops strangers, and tells the facilitator", async () => {
    expect(
      await receiveTranscript({
        job: `${organisationId}/${sessionId}`,
        status: "done",
        segments: [
          { speaker: learner.userId, startedAt: "2026-11-02T16:41:00.000Z", endedAt: "2026-11-02T16:41:04.000Z", text: "Is the job profile the starting point?" },
          { speaker: facilitator.userId, startedAt: "2026-11-02T16:31:00.000Z", endedAt: "2026-11-02T16:31:05.000Z", text: "Good evening, everyone." },
          { speaker: "00000000-0000-0000-0000-000000000001", startedAt: "2026-11-02T16:35:00.000Z", endedAt: "2026-11-02T16:35:01.000Z", text: "Not one of ours." },
        ],
      }),
    ).toBe(true);

    const record = await getClassRecord(facilitator, sessionId);
    expect(record.status).toBe("done");
    expect(record.transcript.map((line) => line.name)).toEqual(["Thandi Tester", "Sam Tester"]);
    expect(record.canPublish).toBe(true);
    await expect(getClassRecord(learner, sessionId)).rejects.toThrow(/facilitator/);

    const told = await withTenant(organisationId, (tx) =>
      tx.select({ userId: notifications.userId }).from(notifications).where(and(eq(notifications.entityId, sessionId), eq(notifications.kind, "class.record_ready"))),
    );
    expect(told.map((one) => one.userId)).toEqual([facilitator.userId]);
  });

  it("lets the facilitator correct a line and write the summary; asks for an AI extension to draft one", async () => {
    await correctTranscript(facilitator, sessionId, 1, "Is the job profile where it starts?");
    await saveSummary(facilitator, sessionId, "You covered job architecture.");
    await expect(draftSummary(facilitator, sessionId)).rejects.toThrow(/AI extension/);
    const record = await getClassRecord(facilitator, sessionId);
    expect(record.transcript[1].text).toBe("Is the job profile where it starts?");
    expect(record.summary).toBe("You covered job architecture.");
  });

  it("shows the cohort nothing until the facilitator publishes", async () => {
    await expect(classNotes(learner, sessionId)).rejects.toThrow(/not been published/);
    expect(await myClassNotes(learner)).toEqual([]);
    // Staff see it waiting for the check.
    expect((await cohortClassNotes(facilitator, cohortId)).map((one) => one.publishedAt)).toEqual([null]);
  });

  it("publishes, and deletes the voices from the media server", async () => {
    await expect(publishRecord(learner, sessionId)).rejects.toThrow(/facilitator/);
    expect(await publishRecord(facilitator, sessionId)).toEqual({ voicesDeleted: true });

    const deletion = asked.find((one) => one.method === "DELETE");
    expect(deletion?.url).toContain(`/jobs/${encodeURIComponent(`${organisationId}/${sessionId}`)}/audio`);
    expect((deletion?.body as { paths: string[] }).paths).toHaveLength(2);

    const [record] = await withTenant(organisationId, (tx) => tx.select().from(classroomRecords).where(eq(classroomRecords.sessionId, sessionId)));
    expect(record.publishedAt).not.toBeNull();
    expect(record.voiceDeletedAt).not.toBeNull();
    const left = await withTenant(organisationId, (tx) => tx.select({ status: classroomRecordings.status }).from(classroomRecordings).where(eq(classroomRecordings.sessionId, sessionId)));
    expect(left.every((one) => one.status === "deleted")).toBe(true);
  });
});

describe("the published notes (phase C)", () => {
  it("tells the cohort's learners, and lets them read the notes with their own attendance", async () => {
    const told = await withTenant(organisationId, (tx) =>
      tx.select({ userId: notifications.userId, linkPath: notifications.linkPath }).from(notifications).where(and(eq(notifications.entityId, sessionId), eq(notifications.kind, "class.notes_published"))),
    );
    expect(told).toEqual([{ userId: learner.userId, linkPath: `/classroom/${sessionId}/notes` }]);

    const notes = await classNotes(learner, sessionId);
    expect(notes.summary).toBe("You covered job architecture.");
    expect(notes.transcript.map((line) => line.text)).toEqual(["Good evening, everyone.", "Is the job profile where it starts?"]);
    expect(notes.facilitatorName).toBe("Thandi Tester");
    expect(notes.myAttendance?.status).toBeDefined();
    // Staff read it too, without an attendance line of their own.
    expect((await classNotes(facilitator, sessionId)).myAttendance).toBeNull();
  });

  it("lists it under the cohort and on the learner's own list, and keeps everybody else out", async () => {
    expect((await myClassNotes(learner)).map((one) => one.sessionId)).toEqual([sessionId]);
    expect((await cohortClassNotes(learner, cohortId)).map((one) => one.sessionId)).toEqual([sessionId]);
    const stranger = await person(`stranger-${Date.now()}@record.test`, "learner", "Lerato");
    await expect(classNotes(stranger, sessionId)).rejects.toThrow(/cohort's learners and its staff/);
    expect(await cohortClassNotes(stranger, cohortId)).toEqual([]);
  });
});
