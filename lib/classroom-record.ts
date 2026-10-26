import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withPlatformScope, withTenant, type TenantDatabase } from "@/db/client";
import {
  attendanceRecords,
  classroomChat,
  classroomNotes,
  classroomPollAnswers,
  classroomPolls,
  classroomRecordings,
  classroomRecords,
  cohortSessions,
  users,
  type TranscriptSegment,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { raise } from "./notifications";
import type { AuthenticatedSession } from "./session";
import { ClassroomError, asHost } from "./classroom";
import * as media from "./classroom-media";
import { deleteVoices, requestTranscription } from "./classroom-transcriber";
import { transcribingWithin } from "./classroom-notice";
import { orderTranscript, transcriptText } from "./classroom-transcript";
import { runExtension } from "./extensions";

/**
 * The record of a class (job sheet D41, phase B): its voices captured while it
 * runs, transcribed on the media server once it ends, summarised with the
 * facilitator's AI extension, checked once by the facilitator and published.
 * Publishing deletes the voices; only the text is kept.
 *
 * Roland, 2 October 2026: the platform does the work, a person verifies once.
 * Heidi, 23 October 2026: the full transcript is kept.
 */

const transcribing = transcribingWithin;

// ---------------------------------------------------------------------------
// Capturing voices, from the media server's reports
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A microphone came on in a class: record it, if the provider transcribes
 * classes. A recorder that will not start is reported and the class goes on;
 * the transcript is then missing that voice, and the facilitator's check is
 * where that is seen.
 */
export async function microphoneStarted(report: { room: string; identity: string; trackId: string; at: Date }): Promise<boolean> {
  const where = media.parseRoomName(report.room);
  if (!where || !UUID.test(report.identity)) return false;

  return withTenant(where.organisationId, async (tx) => {
    if (!(await transcribing(tx, where.organisationId))) return false;
    const [session] = await tx
      .select({ endedAt: cohortSessions.classEndedAt })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, where.sessionId));
    if (!session || session.endedAt) return false;
    const [person] = await tx.select({ id: users.id }).from(users).where(eq(users.id, report.identity));
    if (!person) return false;

    const started = await media.startVoiceRecording(report.room, report.trackId, report.identity);
    await tx
      .insert(classroomRecordings)
      .values({
        organisationId: where.organisationId,
        sessionId: where.sessionId,
        userId: person.id,
        egressId: started.egressId,
        trackId: report.trackId,
        filePath: started.filePath,
        startedAt: report.at,
      })
      .onConflictDoNothing();
    return true;
  });
}

/**
 * A recording closed. Once the class has ended and every recording in it has
 * closed, the class is sent to be transcribed.
 */
export async function recordingEnded(report: { egressId: string; at: Date; failed: boolean }): Promise<boolean> {
  // The recording's own row says which provider it belongs to; nothing else in the report is trusted.
  const [found] = await withPlatformScope("matching a finished class recording to its provider", (tx) =>
    tx
      .select({ organisationId: classroomRecordings.organisationId, sessionId: classroomRecordings.sessionId })
      .from(classroomRecordings)
      .where(eq(classroomRecordings.egressId, report.egressId)),
  );
  if (!found) return false;
  await withTenant(found.organisationId, (tx) =>
    tx
      .update(classroomRecordings)
      .set({ endedAt: report.at, status: report.failed ? "failed" : "ended" })
      .where(and(eq(classroomRecordings.egressId, report.egressId), eq(classroomRecordings.status, "recording"))),
  );
  await transcribeWhenReady(found.organisationId, found.sessionId);
  return true;
}

/**
 * Sends a class to be transcribed if it is ready: ended, and no recording
 * still open. Safe to call as often as reports arrive; only the first call
 * that finds it ready sends it.
 */
export async function transcribeWhenReady(organisationId: string, sessionId: string): Promise<"sent" | "waiting" | "nothing" | "not_yet"> {
  const plan = await withTenant(organisationId, async (tx) => {
    const [session] = await tx.select({ endedAt: cohortSessions.classEndedAt }).from(cohortSessions).where(eq(cohortSessions.id, sessionId));
    if (!session?.endedAt) return { outcome: "not_yet" as const };

    const recordings = await tx
      .select({ userId: classroomRecordings.userId, filePath: classroomRecordings.filePath, startedAt: classroomRecordings.startedAt, status: classroomRecordings.status })
      .from(classroomRecordings)
      .where(eq(classroomRecordings.sessionId, sessionId));
    const open = recordings.some((one) => one.status === "recording");
    const ready = recordings.filter((one) => one.status === "ended");

    await tx
      .insert(classroomRecords)
      .values({ organisationId, sessionId, transcriptStatus: recordings.length ? "waiting" : "none" })
      .onConflictDoNothing();
    if (open) return { outcome: "waiting" as const };
    if (ready.length === 0) {
      await tx
        .update(classroomRecords)
        .set({ transcriptStatus: "none", updatedAt: new Date() })
        .where(and(eq(classroomRecords.sessionId, sessionId), inArray(classroomRecords.transcriptStatus, ["none", "waiting"])));
      return { outcome: "nothing" as const };
    }

    // Claimed by one caller only: whoever moves it from waiting to working sends it.
    const claimed = await tx
      .update(classroomRecords)
      .set({ transcriptStatus: "working", requestedAt: new Date(), transcriptError: null, updatedAt: new Date() })
      .where(and(eq(classroomRecords.sessionId, sessionId), inArray(classroomRecords.transcriptStatus, ["none", "waiting"])))
      .returning({ id: classroomRecords.id });
    if (claimed.length === 0) return { outcome: "waiting" as const };
    return { outcome: "sent" as const, files: ready.map((one) => ({ path: one.filePath, speaker: one.userId, startedAt: one.startedAt.toISOString() })) };
  });

  if (plan.outcome !== "sent") return plan.outcome;
  try {
    // Where the transcriber answers: the site's own address, unless the media
    // server reaches the LMS by another (a private network, or Docker locally).
    const callback = process.env.TRANSCRIBER_CALLBACK_URL || `${process.env.AUTH_URL ?? ""}/api/classroom/transcript`;
    await requestTranscription(`${organisationId}/${sessionId}`, plan.files, callback);
  } catch (error) {
    await withTenant(organisationId, (tx) =>
      tx
        .update(classroomRecords)
        .set({ transcriptStatus: "failed", transcriptError: error instanceof Error ? error.message : String(error), updatedAt: new Date() })
        .where(eq(classroomRecords.sessionId, sessionId)),
    );
  }
  return "sent";
}

/**
 * The transcriber's answer. The job names the provider and the session, and
 * each line names who spoke; a speaker who is not a person at that provider
 * is dropped rather than trusted.
 */
export async function receiveTranscript(answer: {
  job: string;
  status: "done" | "failed";
  segments?: { speaker: string; startedAt: string; endedAt: string; text: string }[];
  error?: string;
}): Promise<boolean> {
  const [organisationId, sessionId] = answer.job.split("/");
  if (!UUID.test(organisationId ?? "") || !UUID.test(sessionId ?? "")) return false;

  return withTenant(organisationId, async (tx) => {
    const [record] = await tx.select({ id: classroomRecords.id }).from(classroomRecords).where(eq(classroomRecords.sessionId, sessionId));
    if (!record) return false;

    if (answer.status === "failed") {
      await tx
        .update(classroomRecords)
        .set({ transcriptStatus: "failed", transcriptError: (answer.error ?? "The transcriber could not finish.").slice(0, 1000), updatedAt: new Date() })
        .where(eq(classroomRecords.id, record.id));
    } else {
      const speakers = [...new Set((answer.segments ?? []).map((one) => one.speaker))].filter((one) => UUID.test(one));
      const known = speakers.length
        ? new Set((await tx.select({ id: users.id }).from(users).where(inArray(users.id, speakers))).map((one) => one.id))
        : new Set<string>();
      const segments: TranscriptSegment[] = orderTranscript(
        (answer.segments ?? [])
          .filter((one) => known.has(one.speaker) && one.text.trim())
          .map((one) => ({ userId: one.speaker, startedAt: one.startedAt, endedAt: one.endedAt, text: one.text.trim() })),
      );
      await tx
        .update(classroomRecords)
        .set({ transcriptStatus: "done", transcript: segments, transcribedAt: new Date(), updatedAt: new Date() })
        .where(eq(classroomRecords.id, record.id));
    }

    // The facilitator is told it is ready to check.
    const [session] = await tx
      .select({ facilitatorId: cohortSessions.facilitatorId, title: cohortSessions.title, kind: cohortSessions.kind })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, sessionId));
    if (session?.facilitatorId) {
      await raise(tx, {
        organisationId,
        userId: session.facilitatorId,
        kind: "class.record_ready",
        subject: answer.status === "done" ? `The class notes are ready to check: ${session.title ?? session.kind}` : `The class could not be transcribed: ${session.title ?? session.kind}`,
        body: answer.status === "done" ? "Check the transcript and the summary, then publish them to the class." : "Publish the notes without a transcript, or ask your administrator to look at the transcriber.",
        linkPath: `/classroom/${sessionId}/record`,
        entityType: "cohort_session",
        entityId: sessionId,
        dedupeKey: `class_record:${sessionId}:${answer.status}`,
      });
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// The facilitator's check
// ---------------------------------------------------------------------------

export type ClassRecordView = {
  sessionId: string;
  cohortId: string;
  title: string | null;
  kind: string;
  scheduledDate: string;
  status: "none" | "waiting" | "working" | "done" | "failed";
  transcriptError: string | null;
  transcript: { index: number; name: string; startedAt: string; text: string }[];
  summary: string;
  notes: string;
  chat: { name: string; body: string; sentAt: Date }[];
  polls: { question: string; options: string[]; counts: number[] }[];
  register: { present: number; absent: number; excused: number };
  publishedAt: Date | null;
  voiceDeletedAt: Date | null;
  ended: boolean;
  /** Whether the facilitator may publish: there is nothing still being written. */
  canPublish: boolean;
};

export async function getClassRecord(session: AuthenticatedSession, sessionId: string): Promise<ClassRecordView> {
  const row = await asHost(session, sessionId);
  return withTenant(session.organisationId, async (tx) => {
    const [record] = await tx.select().from(classroomRecords).where(eq(classroomRecords.sessionId, sessionId));
    const [notes] = await tx.select({ body: classroomNotes.body }).from(classroomNotes).where(eq(classroomNotes.sessionId, sessionId));
    const segments = record?.transcript ?? [];
    const names = await namesOf(tx, [...new Set(segments.map((one) => one.userId))]);
    const chat = await tx
      .select({ body: classroomChat.body, sentAt: classroomChat.sentAt, firstName: users.firstName, lastName: users.lastName })
      .from(classroomChat)
      .innerJoin(users, eq(users.id, classroomChat.userId))
      .where(eq(classroomChat.sessionId, sessionId))
      .orderBy(asc(classroomChat.sentAt));
    const polls = await tx.select({ id: classroomPolls.id, question: classroomPolls.question, options: classroomPolls.options }).from(classroomPolls).where(eq(classroomPolls.sessionId, sessionId)).orderBy(asc(classroomPolls.createdAt));
    const answers = polls.length
      ? await tx.select({ pollId: classroomPollAnswers.pollId, choice: classroomPollAnswers.choice }).from(classroomPollAnswers).where(inArray(classroomPollAnswers.pollId, polls.map((one) => one.id)))
      : [];
    const marks = await tx.select({ status: attendanceRecords.status }).from(attendanceRecords).where(eq(attendanceRecords.sessionId, sessionId));
    const status = (record?.transcriptStatus ?? "none") as ClassRecordView["status"];

    return {
      sessionId,
      cohortId: row.cohortId,
      title: row.title,
      kind: row.kind,
      scheduledDate: row.scheduledDate,
      status,
      transcriptError: record?.transcriptError ?? null,
      transcript: segments.map((one, index) => ({ index, name: names.get(one.userId) ?? "", startedAt: one.startedAt, text: one.text })),
      summary: record?.summary ?? "",
      notes: notes?.body ?? "",
      chat: chat.map((one) => ({ name: `${one.firstName} ${one.lastName}`, body: one.body, sentAt: one.sentAt })),
      polls: polls.map((poll) => ({
        question: poll.question,
        options: poll.options,
        counts: poll.options.map((_, index) => answers.filter((answer) => answer.pollId === poll.id && answer.choice === index).length),
      })),
      register: {
        present: marks.filter((one) => one.status === "present").length,
        absent: marks.filter((one) => one.status === "absent").length,
        excused: marks.filter((one) => one.status === "excused").length,
      },
      publishedAt: record?.publishedAt ?? null,
      voiceDeletedAt: record?.voiceDeletedAt ?? null,
      ended: Boolean(row.classEndedAt),
      canPublish: Boolean(row.classEndedAt) && status !== "waiting" && status !== "working",
    };
  });
}

async function namesOf(tx: TenantDatabase, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const people = await tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, ids));
  return new Map(people.map((one) => [one.id, `${one.firstName} ${one.lastName}`]));
}

async function recordOf(tx: TenantDatabase, organisationId: string, sessionId: string) {
  await tx.insert(classroomRecords).values({ organisationId, sessionId }).onConflictDoNothing();
  const [record] = await tx.select().from(classroomRecords).where(eq(classroomRecords.sessionId, sessionId));
  return record;
}

/** The facilitator's summary, as written or corrected. */
export async function saveSummary(session: AuthenticatedSession, sessionId: string, summary: string): Promise<void> {
  await asHost(session, sessionId);
  await withTenant(session.organisationId, async (tx) => {
    const record = await recordOf(tx, session.organisationId, sessionId);
    await tx.update(classroomRecords).set({ summary: summary.slice(0, 50_000), updatedAt: new Date() }).where(eq(classroomRecords.id, record.id));
  });
}

/** A correction to what the transcript says somebody said. */
export async function correctTranscript(session: AuthenticatedSession, sessionId: string, index: number, text: string): Promise<void> {
  await asHost(session, sessionId);
  await withTenant(session.organisationId, async (tx) => {
    const record = await recordOf(tx, session.organisationId, sessionId);
    const segments = [...(record.transcript ?? [])];
    if (!segments[index]) throw new ClassroomError("That line of the transcript was not found.", "not_found");
    segments[index] = { ...segments[index], text: text.trim().slice(0, 5_000) };
    await tx.update(classroomRecords).set({ transcript: segments, updatedAt: new Date() }).where(eq(classroomRecords.id, record.id));
  });
}

/**
 * A summary drafted by the facilitator's own AI extension, from the
 * transcript and the facilitator's notes. Saved as the summary for them to
 * check; it is theirs to change. The extension receives the text, never the
 * voices.
 */
export async function draftSummary(session: AuthenticatedSession, sessionId: string): Promise<string> {
  const view = await getClassRecord(session, sessionId);
  if (view.transcript.length === 0 && !view.notes.trim()) {
    throw new ClassroomError("There is no transcript or notes to summarise yet.", "invalid_state");
  }
  // About 150,000 characters: a long class, and within what the providers accept.
  const transcript = transcriptText(view.transcript).slice(0, 150_000);
  const result = await runExtension(session, {
    task: "classroom.summary",
    system:
      "You write the notes of a live class for the learners who attended it and those who missed it. " +
      "Write in British English. Do not use em dashes, and do not start a sentence with 'And' or 'But'. " +
      "Address the learners as 'you'. State what was covered, what was explained, any instructions or deadlines given, and the questions raised and their answers. " +
      "Facts only: no opinions, no praise, no padding. Use short headed sections and bullet points. Do not invent anything that is not in the material.",
    prompt: [
      `Class: ${view.title ?? view.kind}, ${view.scheduledDate}.`,
      view.notes.trim() ? `The facilitator's notes:\n${view.notes.trim()}` : "",
      transcript ? `The transcript, each line "Name: words":\n${transcript}` : "",
      "Write the notes.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  if (!result.ok || !result.text) throw new ClassroomError(result.error ?? "Your AI extension did not answer. Write the summary yourself, or try again.", "invalid_state");
  await saveSummary(session, sessionId, result.text.trim());
  return result.text.trim();
}

/**
 * The facilitator's one check, done: the record is published, and the voices
 * are deleted from the media server. If the deletion fails the record is still
 * published, and the deletion is tried again the next time this is called.
 */
export async function publishRecord(session: AuthenticatedSession, sessionId: string): Promise<{ voicesDeleted: boolean }> {
  const view = await getClassRecord(session, sessionId);
  if (!view.ended) throw new ClassroomError("End the class first.", "invalid_state");
  if (!view.canPublish) throw new ClassroomError("The transcript is still being written. You are told when it is ready.", "invalid_state");

  const files = await withTenant(session.organisationId, async (tx) => {
    const record = await recordOf(tx, session.organisationId, sessionId);
    if (!record.publishedAt) {
      await tx
        .update(classroomRecords)
        .set({ publishedAt: new Date(), publishedById: session.userId, updatedAt: new Date() })
        .where(eq(classroomRecords.id, record.id));
      await recordAudit(tx, {
        organisationId: session.organisationId,
        actorId: session.userId,
        actorRole: session.roles[0],
        action: "classroom.record_published",
        entityType: "cohort_session",
        entityId: sessionId,
      });
    }
    return tx
      .select({ filePath: classroomRecordings.filePath })
      .from(classroomRecordings)
      .where(and(eq(classroomRecordings.sessionId, sessionId), inArray(classroomRecordings.status, ["ended", "failed", "recording"])));
  });

  if (files.length === 0) {
    await markVoicesDeleted(session, sessionId);
    return { voicesDeleted: true };
  }
  try {
    await deleteVoices(`${session.organisationId}/${sessionId}`, files.map((one) => one.filePath));
  } catch (error) {
    console.error("Class voices could not be deleted:", error);
    return { voicesDeleted: false };
  }
  await markVoicesDeleted(session, sessionId);
  return { voicesDeleted: true };
}

async function markVoicesDeleted(session: AuthenticatedSession, sessionId: string): Promise<void> {
  await withTenant(session.organisationId, async (tx) => {
    await tx.update(classroomRecordings).set({ status: "deleted" }).where(eq(classroomRecordings.sessionId, sessionId));
    await tx
      .update(classroomRecords)
      .set({ voiceDeletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(classroomRecords.sessionId, sessionId), isNull(classroomRecords.voiceDeletedAt)));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "classroom.voices_deleted",
      entityType: "cohort_session",
      entityId: sessionId,
    });
  });
}

