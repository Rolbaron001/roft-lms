import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  attendanceRecords,
  classroomChat,
  classroomNotes,
  classroomPollAnswers,
  classroomPolls,
  classroomPresence,
  cohortMembers,
  cohortSessions,
  cohorts,
  organisations,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { raise } from "./notifications";
import { can } from "./rbac";
import type { AuthenticatedSession } from "./session";
import { reachWithin, inReach } from "./staff-scope";
import { zonedTimeToUtc } from "./timezone";
import { classLength, markFor, minutesIn } from "./classroom-attendance";
import { heldInClassroom, joinHref } from "./classroom-rules";
import { noticeOwed } from "./classroom-notice";
import * as media from "./classroom-media";

/**
 * The LMS classroom (job sheet D41, phase A): live classes held on and from
 * the LMS. Roland, 23 October 2026: "What happens today gets replaced by the
 * LMS tomorrow."
 *
 * A session is held here when the provider has switched the classroom on and
 * the session is online without an outside meeting link. Nothing has to be
 * marked by hand, so an imported roll-out schedule is ready as it stands; an
 * outside link on a session is the contingency for a class the media server
 * cannot carry.
 *
 * The class itself runs on the media server (lib/classroom-media.ts). The LMS
 * decides who may enter, holds learners in the lobby until the facilitator
 * opens the class, keeps the chat and the facilitator's notes, and fills in
 * the register from the media server's reports of who was there and for how
 * long. Nothing of the class's sound or picture is kept.
 */

export class ClassroomError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "not_permitted" | "invalid_state" | "not_configured",
  ) {
    super(message);
    this.name = "ClassroomError";
  }
}

/** Learners may come in this long before the scheduled start. */
export const LOBBY_MINUTES = 15;

export { heldInClassroom, joinHref };

/** The provider's classroom settings. */
export type ClassroomSettings = {
  enabled: boolean;
  cameras: boolean;
  presentPercent: number;
  timezone: string;
};

export async function classroomSettingsWithin(tx: TenantDatabase, organisationId: string): Promise<ClassroomSettings> {
  const [row] = await tx
    .select({
      enabled: organisations.classroomEnabled,
      cameras: organisations.classroomCameras,
      presentPercent: organisations.classroomPresentPercent,
      timezone: organisations.timezone,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId));
  return row ?? { enabled: false, cameras: true, presentPercent: 75, timezone: "Africa/Johannesburg" };
}

export type ClassroomRole = "host" | "staff" | "learner";

type SessionRow = {
  id: string;
  cohortId: string;
  cohortName: string;
  kind: string;
  title: string | null;
  sequence: number | null;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  deliveryMode: string;
  meetingUrl: string | null;
  status: string;
  facilitatorId: string | null;
  classStartedAt: Date | null;
  classEndedAt: Date | null;
  classBreakout: { startedAt: string; groups: string[][] } | null;
};

/** Which breakout group a person is in, counting from one, or null in the whole class. */
function groupOf(row: Pick<SessionRow, "classBreakout">, userId: string): number | null {
  const index = (row.classBreakout?.groups ?? []).findIndex((group) => group.includes(userId));
  return index >= 0 ? index + 1 : null;
}

export async function sessionRow(tx: TenantDatabase, sessionId: string): Promise<SessionRow> {
  const [row] = await tx
    .select({
      id: cohortSessions.id,
      cohortId: cohortSessions.cohortId,
      cohortName: cohorts.name,
      kind: cohortSessions.kind,
      title: cohortSessions.title,
      sequence: cohortSessions.sequence,
      scheduledDate: cohortSessions.scheduledDate,
      startTime: cohortSessions.startTime,
      endTime: cohortSessions.endTime,
      deliveryMode: cohortSessions.deliveryMode,
      meetingUrl: cohortSessions.meetingUrl,
      status: cohortSessions.status,
      facilitatorId: cohortSessions.facilitatorId,
      classStartedAt: cohortSessions.classStartedAt,
      classEndedAt: cohortSessions.classEndedAt,
      classBreakout: cohortSessions.classBreakout,
    })
    .from(cohortSessions)
    .innerJoin(cohorts, eq(cohorts.id, cohortSessions.cohortId))
    .where(eq(cohortSessions.id, sessionId));
  if (!row) throw new ClassroomError("That class was not found.", "not_found");
  return row;
}

/**
 * Who this person is in the class, or a refusal. The facilitator of the
 * session and staff who run the cohort host it; the cohort's other staff may
 * look in; its current learners attend. Nobody else enters, whatever link they
 * hold.
 */
export async function roleIn(tx: TenantDatabase, session: AuthenticatedSession, row: SessionRow): Promise<ClassroomRole> {
  if (row.facilitatorId === session.userId) return "host";

  const [member] = await tx
    .select({ userId: cohortMembers.userId })
    .from(cohortMembers)
    .where(and(eq(cohortMembers.cohortId, row.cohortId), eq(cohortMembers.userId, session.userId), isNull(cohortMembers.leftAt)));
  if (member) return "learner";

  const staff = session.roles.some((role) => role !== "learner");
  if (staff && inReach(await reachWithin(tx, session), { cohortId: row.cohortId })) {
    return can(session, "session:manage") ? "host" : "staff";
  }
  throw new ClassroomError("Only the cohort's learners and its staff can enter this class.", "not_permitted");
}

export type ClassroomState = "early" | "lobby" | "open" | "ended" | "cancelled";

/** When learners may first come in: fifteen minutes before the start. */
export function opensAt(row: { scheduledDate: string; startTime: string | null }, timezone: string): Date {
  const start = zonedTimeToUtc(row.scheduledDate, row.startTime, timezone);
  return row.startTime ? new Date(start.getTime() - LOBBY_MINUTES * 60_000) : start;
}

function stateOf(row: SessionRow, timezone: string, now: Date): ClassroomState {
  if (row.status === "cancelled" || row.status === "postponed") return "cancelled";
  if (row.classEndedAt) return "ended";
  if (row.classStartedAt) return "open";
  return now < opensAt(row, timezone) ? "early" : "lobby";
}

export type ClassroomView = {
  sessionId: string;
  cohortId: string;
  cohortName: string;
  kind: string;
  title: string | null;
  sequence: number | null;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  facilitatorName: string | null;
  role: ClassroomRole;
  state: ClassroomState;
  opensAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  cameras: boolean;
  /** Whether this server has a media server to hold the class on. */
  configured: boolean;
  chat: { id: string; name: string; body: string; sentAt: Date; mine: boolean; group: number | null }[];
  /** The facilitator's notes, for a host; null for anybody else. */
  notes: string | null;
  polls: PollView[];
  /** The breakout groups while they run, with names, or null in the whole class. */
  breakout: { userId: string; name: string }[][] | null;
  /** This person's own breakout group, or null. */
  myGroup: number | null;
};

export type PollView = {
  id: string;
  question: string;
  options: string[];
  closed: boolean;
  /** How many chose each option: for the facilitator throughout, for everybody once closed. */
  counts: number[] | null;
  /** This person's own answer, by position. */
  mine: number | null;
};

async function heldHere(tx: TenantDatabase, organisationId: string, row: SessionRow): Promise<ClassroomSettings> {
  const settings = await classroomSettingsWithin(tx, organisationId);
  if (!heldInClassroom(settings.enabled, row)) {
    throw new ClassroomError(
      row.meetingUrl ? "This class is held at its outside meeting link, not in the LMS classroom." : "This session is not held in the LMS classroom.",
      "invalid_state",
    );
  }
  return settings;
}

/** Everything the classroom page shows, for the person asking. */
export async function getClassroom(session: AuthenticatedSession, sessionId: string, now: Date = new Date()): Promise<ClassroomView> {
  return withTenant(session.organisationId, async (tx) => {
    const row = await sessionRow(tx, sessionId);
    const role = await roleIn(tx, session, row);
    const settings = await heldHere(tx, session.organisationId, row);

    const [facilitator] = row.facilitatorId
      ? await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, row.facilitatorId))
      : [];
    const chat = await tx
      .select({ id: classroomChat.id, userId: classroomChat.userId, body: classroomChat.body, sentAt: classroomChat.sentAt, group: classroomChat.groupNumber, firstName: users.firstName, lastName: users.lastName })
      .from(classroomChat)
      .innerJoin(users, eq(users.id, classroomChat.userId))
      .where(eq(classroomChat.sessionId, sessionId))
      .orderBy(asc(classroomChat.sentAt));
    const [notes] = role === "host"
      ? await tx.select({ body: classroomNotes.body }).from(classroomNotes).where(eq(classroomNotes.sessionId, sessionId))
      : [];
    const myGroup = groupOf(row, session.userId);
    const polls = await pollsWithin(tx, sessionId, session.userId, role === "host");
    const breakout = role === "host" && row.classBreakout ? await namedGroups(tx, row.classBreakout.groups) : null;

    return {
      sessionId: row.id,
      cohortId: row.cohortId,
      cohortName: row.cohortName,
      kind: row.kind,
      title: row.title,
      sequence: row.sequence,
      scheduledDate: row.scheduledDate,
      startTime: row.startTime,
      endTime: row.endTime,
      facilitatorName: facilitator ? `${facilitator.firstName} ${facilitator.lastName}` : null,
      role,
      state: stateOf(row, settings.timezone, now),
      opensAt: opensAt(row, settings.timezone),
      startedAt: row.classStartedAt,
      endedAt: row.classEndedAt,
      cameras: settings.cameras,
      configured: media.mediaConfigured(),
      // A learner sees the whole class's chat and their own group's; the host sees everything.
      chat: chat
        .filter((line) => role === "host" || line.group === null || line.group === myGroup)
        .map((line) => ({ id: line.id, name: `${line.firstName} ${line.lastName}`, body: line.body, sentAt: line.sentAt, mine: line.userId === session.userId, group: line.group })),
      notes: role === "host" ? (notes?.body ?? "") : null,
      polls,
      breakout,
      myGroup,
    };
  });
}

async function namedGroups(tx: TenantDatabase, groups: string[][]): Promise<{ userId: string; name: string }[][]> {
  const ids = groups.flat();
  const people = ids.length
    ? await tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, ids))
    : [];
  return groups.map((group) =>
    group.map((userId) => {
      const found = people.find((one) => one.id === userId);
      return { userId, name: found ? `${found.firstName} ${found.lastName}` : "" };
    }),
  );
}

async function pollsWithin(tx: TenantDatabase, sessionId: string, userId: string, host: boolean): Promise<PollView[]> {
  const polls = await tx
    .select({ id: classroomPolls.id, question: classroomPolls.question, options: classroomPolls.options, closedAt: classroomPolls.closedAt })
    .from(classroomPolls)
    .where(eq(classroomPolls.sessionId, sessionId))
    .orderBy(asc(classroomPolls.createdAt));
  if (polls.length === 0) return [];
  const answers = await tx
    .select({ pollId: classroomPollAnswers.pollId, userId: classroomPollAnswers.userId, choice: classroomPollAnswers.choice })
    .from(classroomPollAnswers)
    .where(inArray(classroomPollAnswers.pollId, polls.map((poll) => poll.id)));
  return polls.map((poll) => {
    const given = answers.filter((answer) => answer.pollId === poll.id);
    const counts = poll.options.map((_, index) => given.filter((answer) => answer.choice === index).length);
    return {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      closed: Boolean(poll.closedAt),
      counts: host || poll.closedAt ? counts : null,
      mine: given.find((answer) => answer.userId === userId)?.choice ?? null,
    };
  });
}

/** Every room a class is using: the whole class, and each breakout group while they run. */
function roomsOf(organisationId: string, sessionId: string, row: Pick<SessionRow, "classBreakout">): string[] {
  const groups = row.classBreakout?.groups.length ?? 0;
  return [media.roomName(organisationId, sessionId), ...Array.from({ length: groups }, (_, index) => media.roomName(organisationId, sessionId, index + 1))];
}

async function tellRooms(rooms: string[], topic: string, payload: unknown): Promise<void> {
  if (!media.mediaConfigured()) return;
  for (const room of rooms) {
    await media.sendToRoom(room, topic, payload).catch((error: unknown) => {
      // The state is kept either way; pages that missed it catch up when they next ask.
      console.error(`Classroom ${topic} could not be relayed:`, error);
    });
  }
}

/** Where a class stands, for the lobby to ask while it waits. */
export async function classroomState(session: AuthenticatedSession, sessionId: string, now: Date = new Date()): Promise<ClassroomState> {
  return withTenant(session.organisationId, async (tx) => {
    const row = await sessionRow(tx, sessionId);
    await roleIn(tx, session, row);
    const settings = await heldHere(tx, session.organisationId, row);
    return stateOf(row, settings.timezone, now);
  });
}

function requireMedia() {
  if (!media.mediaConfigured()) {
    throw new ClassroomError("The classroom is not set up on this server yet. Use an outside meeting link for this class.", "not_configured");
  }
}

/**
 * A pass into the class: what the browser needs to connect to the media
 * server, for this person, for this class, for a short time. A host opening
 * the class for the first time opens it; anybody else waits in the lobby
 * until the host has.
 */
export async function classPass(
  session: AuthenticatedSession,
  sessionId: string,
  now: Date = new Date(),
  /** A host visiting a breakout group; anybody else goes to their own group, or the whole class. */
  visit: number | null = null,
): Promise<{ url: string; token: string; role: ClassroomRole; group: number | null } | { waiting: ClassroomState } | { notice: true }> {
  requireMedia();
  // Nobody joins a transcribed class without having been told it is transcribed.
  if (await noticeOwed(session)) return { notice: true };
  const { row, role, settings, name } = await withTenant(session.organisationId, async (tx) => {
    const row = await sessionRow(tx, sessionId);
    const role = await roleIn(tx, session, row);
    const settings = await heldHere(tx, session.organisationId, row);
    const [me] = await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, session.userId));
    const state = stateOf(row, settings.timezone, now);
    if (state === "cancelled") throw new ClassroomError("This class was called off.", "invalid_state");

    if (role === "host" && state !== "open") {
      // Opening, or opening again after ending it by mistake.
      await tx
        .update(cohortSessions)
        .set({ classStartedAt: row.classStartedAt ?? now, classEndedAt: null, updatedAt: now })
        .where(eq(cohortSessions.id, sessionId));
      await recordAudit(tx, {
        organisationId: session.organisationId,
        actorId: session.userId,
        actorRole: session.roles[0],
        action: row.classEndedAt ? "classroom.reopened" : "classroom.opened",
        entityType: "cohort_session",
        entityId: sessionId,
      });
      row.classStartedAt = row.classStartedAt ?? now;
      row.classEndedAt = null;
    }
    return { row, role, settings, name: me ? `${me.firstName} ${me.lastName}` : session.email };
  });

  const state = stateOf(row, settings.timezone, now);
  if (state !== "open") return { waiting: state };

  const groups = row.classBreakout?.groups.length ?? 0;
  const group = role === "host" ? (visit && visit >= 1 && visit <= groups ? visit : null) : groupOf(row, session.userId);
  const token = await media.issuePass({
    room: media.roomName(session.organisationId, sessionId, group),
    identity: session.userId,
    name,
    host: role === "host",
    cameras: settings.cameras,
    attributes: { role },
  });
  return { url: media.publicUrl(), token, role, group };
}

// ---------------------------------------------------------------------------
// Breakout groups and polls (Heidi, 23 October 2026: both from the start)
// ---------------------------------------------------------------------------

/**
 * Splits the learners in the class into groups, each in a room of its own.
 * Only learners in the class at that moment are placed; the groups are kept,
 * so a learner whose connection drops goes back to the same group. The
 * facilitator stays in the whole class and can visit any group.
 */
export async function startBreakouts(session: AuthenticatedSession, sessionId: string, count: number): Promise<string[][]> {
  const row = await asHost(session, sessionId);
  if (!row.classStartedAt || row.classEndedAt) throw new ClassroomError("The class is not open.", "invalid_state");
  if (row.classBreakout) throw new ClassroomError("The groups are already running. Bring everyone back first.", "invalid_state");
  if (!Number.isInteger(count) || count < 2 || count > 20) throw new ClassroomError("Choose from 2 to 20 groups.", "invalid_state");

  const groups = await withTenant(session.organisationId, async (tx) => {
    const here = await tx
      .selectDistinct({ userId: classroomPresence.userId })
      .from(classroomPresence)
      .innerJoin(cohortMembers, and(eq(cohortMembers.userId, classroomPresence.userId), eq(cohortMembers.cohortId, row.cohortId), isNull(cohortMembers.leftAt)))
      .where(and(eq(classroomPresence.sessionId, sessionId), isNull(classroomPresence.leftAt)));
    if (here.length < 2) throw new ClassroomError("Fewer than two learners are in the class.", "invalid_state");

    // Shuffled, then dealt round, so groups differ in size by one at most.
    const shuffled = here.map((one) => one.userId).sort(() => Math.random() - 0.5);
    const made: string[][] = Array.from({ length: Math.min(count, shuffled.length) }, () => []);
    shuffled.forEach((userId, index) => made[index % made.length].push(userId));

    await tx
      .update(cohortSessions)
      .set({ classBreakout: { startedAt: new Date().toISOString(), groups: made }, updatedAt: new Date() })
      .where(eq(cohortSessions.id, sessionId));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "classroom.breakouts_started",
      entityType: "cohort_session",
      entityId: sessionId,
      after: { groups: made.length, learners: shuffled.length },
    });
    return made;
  });

  // Everybody in the whole class asks again for a pass, and is sent to their group.
  await tellRooms([media.roomName(session.organisationId, sessionId)], "breakout", { active: true });
  return groups;
}

/** Brings every group back to the whole class. */
export async function endBreakouts(session: AuthenticatedSession, sessionId: string): Promise<void> {
  const row = await asHost(session, sessionId);
  if (!row.classBreakout) return;
  const rooms = roomsOf(session.organisationId, sessionId, row).slice(1);
  await withTenant(session.organisationId, async (tx) => {
    await tx.update(cohortSessions).set({ classBreakout: null, updatedAt: new Date() }).where(eq(cohortSessions.id, sessionId));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "classroom.breakouts_ended",
      entityType: "cohort_session",
      entityId: sessionId,
    });
  });
  await tellRooms(rooms, "breakout", { active: false });
}

/** A question to the class, with two to six answers. */
export async function startPoll(session: AuthenticatedSession, sessionId: string, question: string, options: string[]): Promise<PollView> {
  const row = await asHost(session, sessionId);
  if (!row.classStartedAt || row.classEndedAt) throw new ClassroomError("The class is not open.", "invalid_state");
  const asked = question.trim().slice(0, 300);
  const answers = options.map((option) => option.trim().slice(0, 200)).filter(Boolean);
  if (!asked) throw new ClassroomError("Type the question.", "invalid_state");
  if (answers.length < 2 || answers.length > 6) throw new ClassroomError("Give from two to six answers, one on each line.", "invalid_state");

  const [created] = await withTenant(session.organisationId, (tx) =>
    tx
      .insert(classroomPolls)
      .values({ organisationId: session.organisationId, sessionId, question: asked, options: answers, createdById: session.userId })
      .returning({ id: classroomPolls.id }),
  );
  const poll: PollView = { id: created.id, question: asked, options: answers, closed: false, counts: null, mine: null };
  await tellRooms(roomsOf(session.organisationId, sessionId, row), "poll", poll);
  return { ...poll, counts: answers.map(() => 0) };
}

/** A learner's answer. Once given it stands. */
export async function answerPoll(session: AuthenticatedSession, sessionId: string, pollId: string, choice: number): Promise<void> {
  await withTenant(session.organisationId, async (tx) => {
    const row = await sessionRow(tx, sessionId);
    await roleIn(tx, session, row);
    const [poll] = await tx
      .select({ options: classroomPolls.options, closedAt: classroomPolls.closedAt })
      .from(classroomPolls)
      .where(and(eq(classroomPolls.id, pollId), eq(classroomPolls.sessionId, sessionId)));
    if (!poll) throw new ClassroomError("That poll was not found.", "not_found");
    if (poll.closedAt) throw new ClassroomError("That poll has closed.", "invalid_state");
    if (!Number.isInteger(choice) || choice < 0 || choice >= poll.options.length) throw new ClassroomError("Choose one of the answers.", "invalid_state");
    const inserted = await tx
      .insert(classroomPollAnswers)
      .values({ organisationId: session.organisationId, pollId, userId: session.userId, choice })
      .onConflictDoNothing()
      .returning({ id: classroomPollAnswers.id });
    if (inserted.length === 0) throw new ClassroomError("You have already answered.", "invalid_state");
  });
}

/** Closes a poll and shows the class its results. */
export async function closePoll(session: AuthenticatedSession, sessionId: string, pollId: string): Promise<PollView> {
  const row = await asHost(session, sessionId);
  const poll = await withTenant(session.organisationId, async (tx) => {
    await tx
      .update(classroomPolls)
      .set({ closedAt: new Date() })
      .where(and(eq(classroomPolls.id, pollId), eq(classroomPolls.sessionId, sessionId), isNull(classroomPolls.closedAt)));
    return (await pollsWithin(tx, sessionId, session.userId, true)).find((one) => one.id === pollId);
  });
  if (!poll) throw new ClassroomError("That poll was not found.", "not_found");
  await tellRooms(roomsOf(session.organisationId, sessionId, row), "poll", { ...poll, mine: null });
  return poll;
}

/** The polls with their running results, for the facilitator's panel. */
export async function classPolls(session: AuthenticatedSession, sessionId: string): Promise<PollView[]> {
  await asHost(session, sessionId);
  return withTenant(session.organisationId, (tx) => pollsWithin(tx, sessionId, session.userId, true));
}

export async function asHost(session: AuthenticatedSession, sessionId: string) {
  return withTenant(session.organisationId, async (tx) => {
    const row = await sessionRow(tx, sessionId);
    if ((await roleIn(tx, session, row)) !== "host") {
      throw new ClassroomError("Only the class's facilitator can do that.", "not_permitted");
    }
    await heldHere(tx, session.organisationId, row);
    return row;
  });
}

/** The facilitator's notes, saved as they type. */
export async function saveClassNotes(session: AuthenticatedSession, sessionId: string, body: string): Promise<Date> {
  await asHost(session, sessionId);
  const text = body.slice(0, 100_000);
  const now = new Date();
  await withTenant(session.organisationId, (tx) =>
    tx
      .insert(classroomNotes)
      .values({ organisationId: session.organisationId, sessionId, body: text, updatedById: session.userId, updatedAt: now })
      .onConflictDoUpdate({ target: classroomNotes.sessionId, set: { body: text, updatedById: session.userId, updatedAt: now } }),
  );
  return now;
}

/** A line of chat, kept with the class and sent to everybody in it. */
export async function postClassChat(session: AuthenticatedSession, sessionId: string, body: string, visit: number | null = null) {
  const text = body.trim().slice(0, 2_000);
  if (!text) throw new ClassroomError("Type a message first.", "invalid_state");
  const line = await withTenant(session.organisationId, async (tx) => {
    const row = await sessionRow(tx, sessionId);
    const role = await roleIn(tx, session, row);
    // Said where the person is: a learner in their group, a host in the group they are visiting.
    const groups = row.classBreakout?.groups.length ?? 0;
    const group = role === "host" ? (visit && visit >= 1 && visit <= groups ? visit : null) : groupOf(row, session.userId);
    await heldHere(tx, session.organisationId, row);
    if (!row.classStartedAt || row.classEndedAt) throw new ClassroomError("The class is not open.", "invalid_state");
    const [me] = await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, session.userId));
    const [created] = await tx
      .insert(classroomChat)
      .values({ organisationId: session.organisationId, sessionId, userId: session.userId, body: text, groupNumber: group })
      .returning({ id: classroomChat.id, sentAt: classroomChat.sentAt });
    return { id: created.id, userId: session.userId, name: me ? `${me.firstName} ${me.lastName}` : "", body: text, sentAt: created.sentAt.toISOString(), group };
  });
  // Kept either way; the others see it when they next load the page.
  await tellRooms([media.roomName(session.organisationId, sessionId, line.group)], "chat", line);
  return line;
}

export type HostAction =
  | { action: "mute"; identity: string; trackSid: string }
  | { action: "mute_all" }
  | { action: "remove"; identity: string }
  | { action: "lower_hand"; identity: string };

/** The facilitator's controls over the people in the class. */
export async function hostControl(session: AuthenticatedSession, sessionId: string, control: HostAction): Promise<void> {
  requireMedia();
  await asHost(session, sessionId);
  const room = media.roomName(session.organisationId, sessionId);
  switch (control.action) {
    case "mute":
      await media.muteTrack(room, control.identity, control.trackSid);
      return;
    case "mute_all":
      await media.muteEveryoneBut(room, session.userId);
      return;
    case "remove":
      if (control.identity === session.userId) throw new ClassroomError("You cannot remove yourself.", "invalid_state");
      await media.removeParticipant(room, control.identity);
      await withTenant(session.organisationId, (tx) =>
        recordAudit(tx, {
          organisationId: session.organisationId,
          actorId: session.userId,
          actorRole: session.roles[0],
          action: "classroom.removed_participant",
          entityType: "cohort_session",
          entityId: sessionId,
          after: { userId: control.identity },
        }),
      );
      return;
    case "lower_hand":
      await media.setHand(room, control.identity, false);
      return;
  }
}

/**
 * Ends the class: everybody is let out, every stay still open is closed at
 * this moment, the session is marked held, and the register is filled in for
 * the facilitator to check.
 */
export async function endClass(session: AuthenticatedSession, sessionId: string, now: Date = new Date()): Promise<{ present: number; absent: number }> {
  const row = await asHost(session, sessionId);
  if (!row.classStartedAt) throw new ClassroomError("The class has not been opened.", "invalid_state");

  const result = await withTenant(session.organisationId, async (tx) => {
    await tx
      .update(cohortSessions)
      .set({
        classEndedAt: now,
        classBreakout: null,
        // A class that was held is held; one already marked otherwise is left.
        ...(row.status === "scheduled" ? { status: "completed" as const } : {}),
        updatedAt: now,
      })
      .where(eq(cohortSessions.id, sessionId));
    await tx
      .update(classroomPresence)
      .set({ leftAt: now })
      .where(and(eq(classroomPresence.sessionId, sessionId), isNull(classroomPresence.leftAt)));

    const filled = await fillRegister(tx, session.organisationId, { ...row, classEndedAt: now });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "classroom.ended",
      entityType: "cohort_session",
      entityId: sessionId,
      after: filled,
    });

    await raise(tx, {
      organisationId: session.organisationId,
      userId: session.userId,
      kind: "class.register_to_check",
      subject: `Check the register: ${row.title ?? row.cohortName}`,
      body: `The register was filled in from the classroom: ${filled.present} present, ${filled.absent} absent. Check it and save it.`,
      linkPath: `/cohorts/${row.cohortId}/sessions/${sessionId}`,
      entityType: "cohort_session",
      entityId: sessionId,
      dedupeKey: `class_register:${sessionId}:${now.toISOString()}`,
    });
    return filled;
  });

  if (media.mediaConfigured()) {
    for (const room of roomsOf(session.organisationId, sessionId, row)) {
      await media.closeRoom(room).catch((error: unknown) => {
        console.error("Classroom could not be closed on the media server:", error);
      });
    }
  }
  return result;
}

/**
 * The register, filled in from the classroom. A learner marked by a person
 * already (excused before the class, say) is left as they marked them: the
 * classroom proposes, a person decides. Its own marks carry no marker, which
 * is what tells the register page they are still to be checked.
 */
async function fillRegister(
  tx: TenantDatabase,
  organisationId: string,
  row: SessionRow & { classEndedAt: Date },
): Promise<{ present: number; absent: number }> {
  const settings = await classroomSettingsWithin(tx, organisationId);
  const members = await tx
    .select({ userId: cohortMembers.userId })
    .from(cohortMembers)
    .where(and(eq(cohortMembers.cohortId, row.cohortId), isNull(cohortMembers.leftAt)));
  if (members.length === 0) return { present: 0, absent: 0 };

  const stays = await tx
    .select({ userId: classroomPresence.userId, joinedAt: classroomPresence.joinedAt, leftAt: classroomPresence.leftAt })
    .from(classroomPresence)
    .where(eq(classroomPresence.sessionId, row.id));
  const existing = await tx
    .select({ userId: attendanceRecords.userId, markedById: attendanceRecords.markedById })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.sessionId, row.id), inArray(attendanceRecords.userId, members.map((member) => member.userId))));

  const startedAt = row.classStartedAt!;
  const length = classLength(row, { startedAt, endedAt: row.classEndedAt });
  const tally = { present: 0, absent: 0 };

  for (const { userId } of members) {
    if (existing.some((mark) => mark.userId === userId && mark.markedById !== null)) continue;
    const minutes = minutesIn(stays.filter((stay) => stay.userId === userId), startedAt, row.classEndedAt);
    const status = markFor(minutes, length, settings.presentPercent);
    tally[status] += 1;
    const note = `In the class ${minutes} of ${length} minutes`;
    await tx
      .insert(attendanceRecords)
      .values({ organisationId, sessionId: row.id, userId, status, note, markedById: null })
      .onConflictDoUpdate({
        target: [attendanceRecords.sessionId, attendanceRecords.userId],
        set: { status, note, markedById: null, markedAt: new Date() },
      });
  }
  return tally;
}

// ---------------------------------------------------------------------------
// The media server's reports
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PresenceReport =
  | { event: "joined" | "left"; room: string; identity: string; connectionId: string; at: Date }
  | { event: "room_finished"; room: string; at: Date };

/**
 * Records a join or a departure the media server reported. The room's name
 * says which provider and session it belongs to; anything that does not parse
 * as one of ours, or names somebody who is not a person at that provider, is
 * ignored rather than trusted.
 */
export async function recordPresence(report: PresenceReport): Promise<boolean> {
  const where = media.parseRoomName(report.room);
  if (!where) return false;

  return withTenant(where.organisationId, async (tx) => {
    const [session] = await tx.select({ id: cohortSessions.id }).from(cohortSessions).where(eq(cohortSessions.id, where.sessionId));
    if (!session) return false;

    if (report.event === "room_finished") {
      await tx
        .update(classroomPresence)
        .set({ leftAt: report.at })
        .where(and(eq(classroomPresence.sessionId, where.sessionId), isNull(classroomPresence.leftAt)));
      return true;
    }

    if (!UUID.test(report.identity)) return false;
    const [person] = await tx.select({ id: users.id }).from(users).where(eq(users.id, report.identity));
    if (!person) return false;

    if (report.event === "joined") {
      await tx
        .insert(classroomPresence)
        .values({ organisationId: where.organisationId, sessionId: where.sessionId, userId: person.id, connectionId: report.connectionId, joinedAt: report.at })
        .onConflictDoNothing();
    } else {
      await tx
        .update(classroomPresence)
        .set({ leftAt: report.at })
        .where(
          and(
            eq(classroomPresence.sessionId, where.sessionId),
            eq(classroomPresence.connectionId, report.connectionId),
            isNull(classroomPresence.leftAt),
          ),
        );
    }
    return true;
  });
}
