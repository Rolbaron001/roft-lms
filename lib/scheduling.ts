import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessments,
  attendanceRecords,
  cohortMembers,
  cohortSessions,
  cohorts,
  curriculumModules,
  sessionWorkbooks,
  studyUnits,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The dated occasions a cohort meets, and who was there.
 *
 * Named scheduling rather than sessions because `lib/session.ts` is about
 * signing in. The two words mean entirely different things in this codebase
 * and the shorter one was taken first.
 *
 * Why this exists at all: the client runs on a roll-out schedule. Thirty-odd
 * dated lectures per cohort, each tied to a curriculum module, each handing
 * out one workbook and collecting another, with a register taken at every one.
 * Without it the platform can describe what a learner should study but not
 * that anybody taught it, which is the first thing a monitoring visit asks.
 *
 * It is also a regulatory record rather than a convenience. A credit-bearing
 * programme requires facilitator-led delivery; self-study alone is not
 * permitted. The register is how that is evidenced.
 */

export class SchedulingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "invalid_state"
      | "not_permitted",
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** "18:30", "9:05". Kept as text; see the schema for why. */
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;

export const sessionInput = z.object({
  cohortId: z.string().uuid(),
  kind: z
    .enum([
      "induction",
      "lecture",
      "revision",
      "summative",
      "mock_eisa",
      "workplace_induction",
      "walk_in",
    ])
    .default("lecture"),
  title: z.string().trim().max(300).optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  startTime: z.string().regex(CLOCK, "Use a 24-hour time, e.g. 18:30.").optional(),
  endTime: z.string().regex(CLOCK, "Use a 24-hour time, e.g. 20:30.").optional(),
  deliveryMode: z.enum(["virtual", "in_person", "blended"]).default("virtual"),
  meetingUrl: z.string().trim().url().max(1000).optional(),
  venue: z.string().trim().max(300).optional(),
  facilitatorId: z.string().uuid().optional(),
  curriculumModuleId: z.string().uuid().optional(),
  studyUnitId: z.string().uuid().optional(),
  /** Left unset for anything outside the lecture count. */
  sequence: z.coerce.number().int().min(1).max(500).optional(),
});

/**
 * What a caller supplies, which is not what the parser returns: `kind` and
 * `deliveryMode` carry defaults, so requiring them of every call site would
 * make the defaults decorative.
 */
export type SessionInput = z.input<typeof sessionInput>;

export async function scheduleSession(
  session: AuthenticatedSession,
  input: SessionInput,
) {
  assertSessionCan(session, "session:manage");
  const parsed = sessionInput.parse(input);

  if (
    parsed.startTime &&
    parsed.endTime &&
    parsed.endTime <= parsed.startTime
  ) {
    // Lexicographic comparison is exact for zero-padded 24-hour times, and
    // these are validated to that shape above.
    throw new SchedulingError(
      `A session cannot end at ${parsed.endTime} having started at ${parsed.startTime}.`,
      "invalid_state",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(eq(cohorts.id, parsed.cohortId));

    if (!cohort) {
      throw new SchedulingError("Cohort not found.", "not_found");
    }

    const [created] = await tx
      .insert(cohortSessions)
      .values({
        organisationId: session.organisationId,
        cohortId: parsed.cohortId,
        kind: parsed.kind,
        title: parsed.title ?? null,
        scheduledDate: parsed.scheduledDate,
        startTime: parsed.startTime ?? null,
        endTime: parsed.endTime ?? null,
        deliveryMode: parsed.deliveryMode,
        meetingUrl: parsed.meetingUrl ?? null,
        venue: parsed.venue ?? null,
        facilitatorId: parsed.facilitatorId ?? null,
        curriculumModuleId: parsed.curriculumModuleId ?? null,
        studyUnitId: parsed.studyUnitId ?? null,
        sequence: parsed.sequence ?? null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "session.scheduled",
      entityType: "cohort_session",
      entityId: created.id,
      after: {
        cohortId: parsed.cohortId,
        kind: parsed.kind,
        scheduledDate: parsed.scheduledDate,
      },
    });

    return created;
  });
}

/**
 * Marks a session held, cancelled or postponed.
 *
 * The client's tracker moves a lesson from "Not Yet Started" to Complete,
 * Cancelled or Postponed, and their percentage complete is driven from it. A
 * cancelled session is excluded from attendance entirely rather than counted
 * as an absence: nobody failed to attend a lecture that did not happen.
 */
export async function setSessionStatus(
  session: AuthenticatedSession,
  sessionId: string,
  status: "scheduled" | "completed" | "cancelled" | "postponed",
  note?: string,
) {
  assertSessionCan(session, "session:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select({ id: cohortSessions.id, status: cohortSessions.status })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, sessionId));

    if (!existing) {
      throw new SchedulingError("Session not found.", "not_found");
    }

    if ((status === "cancelled" || status === "postponed") && !note?.trim()) {
      throw new SchedulingError(
        "Say why the session was cancelled or postponed. A schedule with unexplained gaps in it is the thing a monitoring visit asks about.",
        "invalid_state",
      );
    }

    await tx
      .update(cohortSessions)
      .set({ status, statusNote: note?.trim() || null, updatedAt: new Date() })
      .where(eq(cohortSessions.id, sessionId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "session.status_changed",
      entityType: "cohort_session",
      entityId: sessionId,
      before: { status: existing.status },
      after: { status, note: note ?? null },
    });
  });
}

/** Attaches a workbook to a session as handed out, submitted, or returned. */
export async function setSessionWorkbook(
  session: AuthenticatedSession,
  sessionId: string,
  assessmentId: string,
  role: "handout" | "submission" | "feedback" | "moderation",
) {
  assertSessionCan(session, "session:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [target] = await tx
      .select({ id: cohortSessions.id })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, sessionId));
    if (!target) throw new SchedulingError("Session not found.", "not_found");

    const [workbook] = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(eq(assessments.id, assessmentId));
    if (!workbook) throw new SchedulingError("Workbook not found.", "not_found");

    await tx
      .insert(sessionWorkbooks)
      .values({
        organisationId: session.organisationId,
        sessionId,
        assessmentId,
        role,
      })
      .onConflictDoNothing();
  });
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export type ScheduledSession = {
  id: string;
  sequence: number | null;
  kind: string;
  title: string | null;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  deliveryMode: string;
  meetingUrl: string | null;
  venue: string | null;
  status: string;
  statusNote: string | null;
  facilitator: string | null;
  moduleCode: string | null;
  studyUnitCode: string | null;
  workbooks: { role: string; title: string }[];
  /** How many of the cohort have been marked, and how many were present. */
  register: { marked: number; present: number; expected: number };
};

/**
 * The roll-out schedule for one cohort, in the order it happens.
 *
 * This is the view that replaces the client's Roll-Out worksheet: dated
 * lectures, what each covers, which workbook is handed out and collected, and
 * whether the register has been taken.
 */
export async function cohortSchedule(
  session: AuthenticatedSession,
  cohortId: string,
): Promise<ScheduledSession[]> {
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: cohortSessions.id,
        sequence: cohortSessions.sequence,
        kind: cohortSessions.kind,
        title: cohortSessions.title,
        scheduledDate: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        endTime: cohortSessions.endTime,
        deliveryMode: cohortSessions.deliveryMode,
        meetingUrl: cohortSessions.meetingUrl,
        venue: cohortSessions.venue,
        status: cohortSessions.status,
        statusNote: cohortSessions.statusNote,
        facilitatorFirst: users.firstName,
        facilitatorLast: users.lastName,
        moduleCode: curriculumModules.code,
        studyUnitCode: studyUnits.code,
      })
      .from(cohortSessions)
      .leftJoin(users, eq(users.id, cohortSessions.facilitatorId))
      .leftJoin(
        curriculumModules,
        eq(curriculumModules.id, cohortSessions.curriculumModuleId),
      )
      .leftJoin(studyUnits, eq(studyUnits.id, cohortSessions.studyUnitId))
      .where(eq(cohortSessions.cohortId, cohortId))
      .orderBy(asc(cohortSessions.scheduledDate), asc(cohortSessions.startTime));

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);

    const books = await tx
      .select({
        sessionId: sessionWorkbooks.sessionId,
        role: sessionWorkbooks.role,
        title: assessments.title,
      })
      .from(sessionWorkbooks)
      .innerJoin(assessments, eq(assessments.id, sessionWorkbooks.assessmentId))
      .where(inArray(sessionWorkbooks.sessionId, ids));

    const marks = await tx
      .select({
        sessionId: attendanceRecords.sessionId,
        status: attendanceRecords.status,
        count: sql<number>`count(*)::int`,
      })
      .from(attendanceRecords)
      .where(inArray(attendanceRecords.sessionId, ids))
      .groupBy(attendanceRecords.sessionId, attendanceRecords.status);

    const [{ expected }] = await tx
      .select({ expected: sql<number>`count(*)::int` })
      .from(cohortMembers)
      .where(
        and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)),
      );

    return rows.map((row) => {
      const forSession = marks.filter((m) => m.sessionId === row.id);
      return {
        id: row.id,
        sequence: row.sequence,
        kind: row.kind,
        title: row.title,
        scheduledDate: row.scheduledDate,
        startTime: row.startTime,
        endTime: row.endTime,
        deliveryMode: row.deliveryMode,
        meetingUrl: row.meetingUrl,
        venue: row.venue,
        status: row.status,
        statusNote: row.statusNote,
        facilitator: row.facilitatorFirst
          ? `${row.facilitatorFirst} ${row.facilitatorLast}`
          : null,
        moduleCode: row.moduleCode,
        studyUnitCode: row.studyUnitCode,
        workbooks: books
          .filter((b) => b.sessionId === row.id)
          .map((b) => ({ role: b.role, title: b.title })),
        register: {
          marked: forSession.reduce((total, m) => total + m.count, 0),
          present:
            forSession.find((m) => m.status === "present")?.count ?? 0,
          expected,
        },
      };
    });
  });
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

export type RegisterLine = {
  userId: string;
  name: string;
  status: "present" | "absent" | "excused" | null;
  note: string | null;
};

/** Everyone still in the cohort, with whatever has already been marked. */
export async function sessionRegister(
  session: AuthenticatedSession,
  sessionId: string,
): Promise<{ session: { id: string; date: string; kind: string; title: string | null }; lines: RegisterLine[] }> {
  return withTenant(session.organisationId, async (tx) => {
    const [target] = await tx
      .select({
        id: cohortSessions.id,
        cohortId: cohortSessions.cohortId,
        date: cohortSessions.scheduledDate,
        kind: cohortSessions.kind,
        title: cohortSessions.title,
      })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, sessionId));

    if (!target) throw new SchedulingError("Session not found.", "not_found");

    const members = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(
        and(
          eq(cohortMembers.cohortId, target.cohortId),
          isNull(cohortMembers.leftAt),
        ),
      )
      .orderBy(asc(users.lastName), asc(users.firstName));

    const existing = await tx
      .select({
        userId: attendanceRecords.userId,
        status: attendanceRecords.status,
        note: attendanceRecords.note,
      })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.sessionId, sessionId));

    return {
      session: {
        id: target.id,
        date: target.date,
        kind: target.kind,
        title: target.title,
      },
      lines: members.map((member) => {
        const mark = existing.find((e) => e.userId === member.userId);
        return {
          userId: member.userId,
          name: `${member.firstName} ${member.lastName}`,
          status: mark?.status ?? null,
          note: mark?.note ?? null,
        };
      }),
    };
  });
}

/**
 * Records who was there.
 *
 * Marks are upserted rather than inserted, because a register gets corrected:
 * somebody arrives late, or a medical note turns an absence into an excusal
 * the following week. Every change is audited, so the correction is visible
 * rather than silent.
 */
export async function takeRegister(
  session: AuthenticatedSession,
  sessionId: string,
  marks: { userId: string; status: "present" | "absent" | "excused"; note?: string }[],
) {
  assertSessionCan(session, "attendance:record");

  return withTenant(session.organisationId, async (tx) => {
    const [target] = await tx
      .select({
        id: cohortSessions.id,
        cohortId: cohortSessions.cohortId,
        status: cohortSessions.status,
      })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, sessionId));

    if (!target) throw new SchedulingError("Session not found.", "not_found");

    if (target.status === "cancelled") {
      throw new SchedulingError(
        "This session was cancelled, so there is no register to take. Nobody failed to attend a lecture that did not happen.",
        "invalid_state",
      );
    }

    if (marks.length === 0) return { marked: 0 };

    // Only people actually in the cohort. A register naming somebody who is
    // not on the programme is the kind of thing that survives into a statutory
    // return and has to be explained.
    const members = await tx
      .select({ userId: cohortMembers.userId })
      .from(cohortMembers)
      .where(
        and(
          eq(cohortMembers.cohortId, target.cohortId),
          isNull(cohortMembers.leftAt),
        ),
      );
    const allowed = new Set(members.map((m) => m.userId));

    const stranger = marks.find((mark) => !allowed.has(mark.userId));
    if (stranger) {
      throw new SchedulingError(
        "That person is not a current member of this cohort, so they cannot be marked on its register.",
        "invalid_state",
      );
    }

    for (const mark of marks) {
      await tx
        .insert(attendanceRecords)
        .values({
          organisationId: session.organisationId,
          sessionId,
          userId: mark.userId,
          status: mark.status,
          note: mark.note?.trim() || null,
          markedById: session.userId,
        })
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.userId],
          set: {
            status: mark.status,
            note: mark.note?.trim() || null,
            markedById: session.userId,
            markedAt: new Date(),
          },
        });
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "attendance.recorded",
      entityType: "cohort_session",
      entityId: sessionId,
      after: {
        marked: marks.length,
        present: marks.filter((m) => m.status === "present").length,
      },
    });

    return { marked: marks.length };
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export type LearnerAttendance = {
  userId: string;
  name: string;
  present: number;
  absent: number;
  excused: number;
  /** Of every session that counts, held or not. */
  overallPercent: number;
  /** Of the sessions held so far. */
  toDatePercent: number;
};

export type CohortAttendance = {
  /** Sessions that count towards a rate: not cancelled, not voluntary. */
  countable: number;
  /** Of those, the ones that have happened. */
  held: number;
  learners: LearnerAttendance[];
};

/**
 * Attendance for a cohort, both ways the client reads it.
 *
 * They keep two percentages side by side and both are needed. Overall is
 * against the whole programme and answers "will this learner have attended
 * enough by the end"; to date is against what has actually been held and
 * answers "are they keeping up". Early in a programme the first is
 * meaninglessly low and the second is the honest number; at the end they
 * converge.
 *
 * Two kinds of session are left out of both, deliberately. A cancelled or
 * postponed lecture never happened, so counting it would penalise a learner
 * for the provider's decision. A walk-in is voluntary, so absence from it says
 * nothing at all.
 */
export async function cohortAttendance(
  session: AuthenticatedSession,
  cohortId: string,
  /** Defaults to today. Passed in by tests so the arithmetic is checkable. */
  asAt: Date = new Date(),
): Promise<CohortAttendance> {
  return withTenant(session.organisationId, async (tx) => {
    const all = await tx
      .select({
        id: cohortSessions.id,
        kind: cohortSessions.kind,
        status: cohortSessions.status,
        scheduledDate: cohortSessions.scheduledDate,
      })
      .from(cohortSessions)
      .where(eq(cohortSessions.cohortId, cohortId));

    const countable = all.filter(
      (s) =>
        s.kind !== "walk_in" &&
        s.status !== "cancelled" &&
        s.status !== "postponed",
    );

    const today = asAt.toISOString().slice(0, 10);
    const held = countable.filter(
      (s) => s.status === "completed" || s.scheduledDate <= today,
    );

    const members = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(
        and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)),
      )
      .orderBy(asc(users.lastName), asc(users.firstName));

    const countableIds = countable.map((s) => s.id);
    const heldIds = new Set(held.map((s) => s.id));

    const marks = countableIds.length
      ? await tx
          .select({
            userId: attendanceRecords.userId,
            sessionId: attendanceRecords.sessionId,
            status: attendanceRecords.status,
          })
          .from(attendanceRecords)
          .where(inArray(attendanceRecords.sessionId, countableIds))
      : [];

    const pct = (part: number, whole: number) =>
      whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

    return {
      countable: countable.length,
      held: held.length,
      learners: members.map((member) => {
        const mine = marks.filter((m) => m.userId === member.userId);
        const present = mine.filter((m) => m.status === "present");
        const presentHeld = present.filter((m) => heldIds.has(m.sessionId));

        return {
          userId: member.userId,
          name: `${member.firstName} ${member.lastName}`,
          present: present.length,
          absent: mine.filter((m) => m.status === "absent").length,
          excused: mine.filter((m) => m.status === "excused").length,
          overallPercent: pct(present.length, countable.length),
          toDatePercent: pct(presentHeld.length, held.length),
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/**
 * The cohort name the client uses: the programme, then the induction date.
 *
 * "HRM Administrator Cohort 28012026". The date is the induction rather than
 * the first lecture, because that is the date their regulatory timelines are
 * measured from, and the format is theirs rather than an ISO one for the same
 * reason it is worth having a helper at all: this is how it appears on
 * documents that leave the building.
 */
export function suggestCohortName(
  programmeName: string,
  inductionDate: Date | string,
): string {
  const date =
    typeof inductionDate === "string" ? new Date(inductionDate) : inductionDate;

  if (Number.isNaN(date.getTime())) {
    throw new SchedulingError(
      "That induction date cannot be read, so a cohort name cannot be built from it.",
      "invalid_state",
    );
  }

  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();

  return `${programmeName.trim()} Cohort ${dd}${mm}${yyyy}`;
}
