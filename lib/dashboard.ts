import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, min, ne, notInArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentSubmissions,
  attendanceRecords,
  cohortMembers,
  cohortSessions,
  cohorts,
  feedbackRequests,
  feedbackResponses,
  moderationQueue,
  qualifications,
  users,
  workplaceLogbooks,
} from "@/db/schema";
import { overdueAcknowledgements, openAppeals } from "./appeals";
import { COHORT_STEPS, cohortJourney, type CohortStepKey } from "./cohort-journey";
import { listCohorts } from "./cohorts";
import { verificationOf } from "./qualification-build";
import { cohortCourseIds } from "./schedule";
import { cohortAttendance } from "./scheduling";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { blockedLearners } from "./spine";
import { notificationDue } from "./statutory-notification";

/**
 * The administrator's dashboard (job sheet D25, Roland, 8 October 2026: "The
 * Dashboard opens at login and contains items that are relevant to the user's
 * role ... navigation is key"). Designed on the canvas and approved by Roland
 * the same day. Everything here is read from what the platform already holds;
 * each item carries where it is worked on, so the screen is a set of ways in
 * rather than a report.
 *
 * Words are left to the page: the items carry codes and numbers, so that the
 * phrases stay in the catalogue and translate.
 */

export type UrgentKey = "leisa" | "toAssess" | "appeals" | "registers" | "logbooks" | "toModerate";

export type AdminDashboard = {
  urgent: { key: UrgentKey; count: number; href: string; on: string | null; tone: "danger" | "warning" | "plain" }[];
  running: {
    id: string;
    name: string;
    programme: string | null;
    learners: number;
    attendancePercent: number | null;
    elapsedPercent: number | null;
    week: number;
    weeks: number | null;
    next: { sessionId: string; date: string; startTime: string | null; title: string | null; kind: string; sequence: number | null } | null;
    facilitator: string | null;
    heldUp: number;
    /** A step of setting up still not done, though the cohort has started. */
    missingStep: CohortStepKey | null;
  }[];
  setup: { id: string; name: string; startDate: string; learners: number; next: CohortStepKey; step: number }[];
  atRisk: { userId: string; name: string; cohortId: string; cohortName: string; reason: "blocked" | "absent"; detail: string }[];
  today: { sessionId: string; cohortId: string; cohortName: string; title: string | null; kind: string; sequence: number | null; startTime: string | null; meetingUrl: string | null }[];
  due: { date: string; kind: "leisaTarget" | "leisa" | "summative"; cohortId: string; cohortName: string; count: number; overdue: boolean }[];
  qualifications: { id: string; title: string; saqaId: string | null; blocking: number; toCheck: number }[];
  waiting: { toAssess: number; toModerate: number; withCoaches: number; assessHref: string; moderateHref: string };
  feedback: { responses: number; cohortId: string | null; cohortName: string | null };
};

const DAY = 24 * 60 * 60 * 1000;
const iso = (at: Date) => at.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY));
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY);

export async function adminDashboard(
  session: AuthenticatedSession,
  options: { leisaTargetHours: number | null; now?: Date } = { leisaTargetHours: null },
): Promise<AdminDashboard> {
  assertSessionCan(session, "enrolment:read_all");
  const now = options.now ?? new Date();
  const today = iso(now);
  const fortnight = addDays(today, 14);
  const can = (permission: string) => session.permissions.includes(permission as never);

  const all = (await listCohorts(session)).filter((row) => row.status !== "cancelled" && row.status !== "finished");
  const runningRows = all.filter((row) => row.startDate <= today && (!row.endDate || row.endDate >= today));

  // Who is on each cohort, for counts and for keeping per-course lists to the cohort.
  const members = all.length
    ? await withTenant(session.organisationId, (tx) =>
        tx
          .select({ cohortId: cohortMembers.cohortId, userId: cohortMembers.userId })
          .from(cohortMembers)
          .where(and(inArray(cohortMembers.cohortId, all.map((row) => row.id)), isNull(cohortMembers.leftAt))),
      )
    : [];
  const membersOf = (cohortId: string) => members.filter((row) => row.cohortId === cohortId).map((row) => row.userId);

  // ---- The cohorts being set up: not started, with a step before "running it"
  // still to do. One that has started stays under the running cohorts, with
  // the missing step named on it.
  const journeys = await Promise.all(all.map((row) => cohortJourney(session, row.id)));
  const missing = (journey: (typeof journeys)[number]) =>
    journey.next && COHORT_STEPS.indexOf(journey.next) < COHORT_STEPS.indexOf("run") ? journey.next : null;
  const setup = journeys
    .filter((journey) => !journey.started && missing(journey))
    .map((journey) => ({
      id: journey.cohort.id,
      name: journey.cohort.name,
      startDate: journey.cohort.startDate,
      learners: membersOf(journey.cohort.id).length,
      next: journey.next!,
      step: COHORT_STEPS.indexOf(journey.next!) + 1,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const sessionData = await withTenant(session.organisationId, async (tx) => {
    const ids = all.map((row) => row.id);
    if (ids.length === 0) return { upcoming: [], past: [], marks: [], courses: new Map<string, string[]>() };
    const upcoming = await tx
      .select({
        id: cohortSessions.id,
        cohortId: cohortSessions.cohortId,
        date: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        title: cohortSessions.title,
        kind: cohortSessions.kind,
        sequence: cohortSessions.sequence,
        meetingUrl: cohortSessions.meetingUrl,
        facilitatorFirst: users.firstName,
        facilitatorLast: users.lastName,
      })
      .from(cohortSessions)
      .leftJoin(users, eq(users.id, cohortSessions.facilitatorId))
      .where(and(inArray(cohortSessions.cohortId, ids), gte(cohortSessions.scheduledDate, today), lte(cohortSessions.scheduledDate, fortnight), notInArray(cohortSessions.status, ["cancelled", "postponed"])))
      .orderBy(asc(cohortSessions.scheduledDate), asc(cohortSessions.startTime));
    // Sessions already held, newest first, apart from the voluntary walk-in.
    const past = await tx
      .select({ id: cohortSessions.id, cohortId: cohortSessions.cohortId, date: cohortSessions.scheduledDate, title: cohortSessions.title, sequence: cohortSessions.sequence })
      .from(cohortSessions)
      .where(and(inArray(cohortSessions.cohortId, ids), lt(cohortSessions.scheduledDate, today), notInArray(cohortSessions.status, ["cancelled", "postponed"]), ne(cohortSessions.kind, "walk_in")))
      .orderBy(desc(cohortSessions.scheduledDate));
    const marks = past.length
      ? await tx
          .select({ sessionId: attendanceRecords.sessionId, userId: attendanceRecords.userId, status: attendanceRecords.status })
          .from(attendanceRecords)
          .where(inArray(attendanceRecords.sessionId, past.map((row) => row.id)))
      : [];
    const courses = new Map<string, string[]>();
    for (const row of runningRows) courses.set(row.id, await cohortCourseIds(tx, row));
    return { upcoming, past, marks, courses };
  });

  // ---- Learners held up: stuck at a step, or absent from the last two sessions.
  const atRisk: AdminDashboard["atRisk"] = [];
  const heldUpBy = new Map<string, number>();
  for (const row of runningRows) {
    const mine = new Set(membersOf(row.id));
    const blocked = (await Promise.all((sessionData.courses.get(row.id) ?? []).map((courseId) => blockedLearners(session, courseId))))
      .flat()
      .filter((learner) => mine.has(learner.userId));
    const seen = new Set<string>();
    for (const learner of blocked) {
      if (seen.has(learner.userId)) continue;
      seen.add(learner.userId);
      atRisk.push({ userId: learner.userId, name: `${learner.firstName} ${learner.lastName}`, cohortId: row.id, cohortName: row.name, reason: "blocked", detail: learner.stepTitle });
    }
    const held = sessionData.past.filter((one) => one.cohortId === row.id && sessionData.marks.some((mark) => mark.sessionId === one.id)).slice(0, 2);
    if (held.length === 2) {
      for (const userId of mine) {
        const absent = held.every((one) => sessionData.marks.some((mark) => mark.sessionId === one.id && mark.userId === userId && mark.status === "absent"));
        if (absent && !seen.has(userId)) {
          seen.add(userId);
          atRisk.push({ userId, name: "", cohortId: row.id, cohortName: row.name, reason: "absent", detail: held.map((one) => one.date).join(",") });
        }
      }
    }
    heldUpBy.set(row.id, seen.size);
  }
  // Names for the absent, in one query.
  const nameless = atRisk.filter((row) => !row.name).map((row) => row.userId);
  if (nameless.length) {
    const names = await withTenant(session.organisationId, (tx) =>
      tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, nameless)),
    );
    for (const row of atRisk) {
      const found = names.find((one) => one.id === row.userId);
      if (!row.name && found) row.name = `${found.firstName} ${found.lastName}`;
    }
  }

  // ---- The cohorts running now.
  const running: AdminDashboard["running"] = [];
  for (const row of runningRows) {
    const attendance = await cohortAttendance(session, row.id, now);
    const counted = attendance.learners.filter((line) => line.toDatePercent !== null);
    const next = sessionData.upcoming.find((one) => one.cohortId === row.id) ?? null;
    const span = row.endDate ? daysBetween(row.startDate, row.endDate) : null;
    const gone = daysBetween(row.startDate, today);
    running.push({
      id: row.id,
      name: row.name,
      programme: row.courseTitle,
      learners: membersOf(row.id).length,
      attendancePercent: attendance.countable > 0 && counted.length ? Math.round(counted.reduce((sum, line) => sum + (line.toDatePercent ?? 0), 0) / counted.length) : null,
      elapsedPercent: span && span > 0 ? Math.min(100, Math.max(0, Math.round((gone / span) * 100))) : null,
      week: Math.floor(gone / 7) + 1,
      weeks: span ? Math.ceil(span / 7) : null,
      next: next ? { sessionId: next.id, date: next.date, startTime: next.startTime, title: next.title, kind: next.kind, sequence: next.sequence } : null,
      facilitator: next?.facilitatorFirst ? `${next.facilitatorFirst} ${next.facilitatorLast ?? ""}`.trim() : null,
      heldUp: heldUpBy.get(row.id) ?? 0,
      missingStep: (() => {
        const journey = journeys.find((one) => one.cohort.id === row.id);
        return journey ? missing(journey) : null;
      })(),
    });
  }

  // ---- Today's timetable.
  const name = (cohortId: string) => all.find((row) => row.id === cohortId)?.name ?? "";
  const todays = sessionData.upcoming
    .filter((one) => one.date === today)
    .map((one) => ({ sessionId: one.id, cohortId: one.cohortId, cohortName: name(one.cohortId), title: one.title, kind: one.kind, sequence: one.sequence, startTime: one.startTime, meetingUrl: one.meetingUrl }));

  // ---- Registers not taken: a session held, on a cohort with learners, with no marks.
  const unmarked = sessionData.past.filter(
    (one) => membersOf(one.cohortId).length > 0 && !sessionData.marks.some((mark) => mark.sessionId === one.id),
  );

  // ---- The LEISA, per cohort, against the regulator's limit and the provider's own target.
  const leisa = (await notificationDue(session, today)).filter(
    (row) => row.cohortId && (row.state === "overdue" || row.state === "due_soon" || row.state === "in_hand"),
  );
  const due: AdminDashboard["due"] = [];
  for (const cohortId of [...new Set(leisa.map((row) => row.cohortId!))]) {
    const rows = leisa.filter((row) => row.cohortId === cohortId);
    const limit = rows.map((row) => row.dueOn).filter((d): d is string => Boolean(d)).sort()[0];
    const induction = rows.map((row) => row.inductionOn).filter((d): d is string => Boolean(d)).sort()[0];
    const cohortName = rows[0].cohortName ?? "";
    // Once the limit itself has passed, the target is no longer the point.
    const limitPassed = Boolean(limit && limit < today);
    if (options.leisaTargetHours && induction && !limitPassed) {
      const target = addDays(induction, Math.ceil(options.leisaTargetHours / 24));
      if (target <= fortnight) due.push({ date: target, kind: "leisaTarget", cohortId, cohortName, count: rows.length, overdue: target < today });
    }
    if (limit && limit <= fortnight) due.push({ date: limit, kind: "leisa", cohortId, cohortName, count: rows.length, overdue: limitPassed });
  }
  for (const one of sessionData.upcoming.filter((row) => row.kind === "summative" || row.kind === "mock_eisa")) {
    due.push({ date: one.date, kind: "summative", cohortId: one.cohortId, cohortName: name(one.cohortId), count: membersOf(one.cohortId).length, overdue: false });
  }
  due.sort((a, b) => a.date.localeCompare(b.date));
  const leisaFirst = due.find((row) => row.kind === "leisaTarget" || row.kind === "leisa")?.date ?? leisa.map((row) => row.dueOn).filter((d): d is string => Boolean(d)).sort()[0] ?? null;

  // ---- Work waiting, whoever it is waiting on.
  const queues = await withTenant(session.organisationId, async (tx) => {
    const [assess] = await tx
      .select({ n: count(), oldest: min(assessmentSubmissions.submittedAt) })
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.status, "submitted"));
    // The oldest of each queue, so a tile can open the item itself.
    const [firstSubmission] = await tx
      .select({ id: assessmentSubmissions.id, userId: assessmentSubmissions.userId })
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.status, "submitted"))
      .orderBy(asc(assessmentSubmissions.submittedAt))
      .limit(1);
    const [firstLogbook] = await tx
      .select({ id: workplaceLogbooks.id })
      .from(workplaceLogbooks)
      .where(eq(workplaceLogbooks.status, "submitted_to_coach"))
      .orderBy(asc(workplaceLogbooks.submittedAt))
      .limit(1);
    const [moderate] = await tx.select({ n: count() }).from(moderationQueue).where(isNull(moderationQueue.resolvedAt));
    const [coaches] = await tx
      .select({ n: count(), oldest: min(workplaceLogbooks.submittedAt) })
      .from(workplaceLogbooks)
      .where(eq(workplaceLogbooks.status, "submitted_to_coach"));
    const week = new Date(now.getTime() - 7 * DAY);
    const responses = await tx
      .select({ cohortId: feedbackRequests.cohortId, cohortName: cohorts.name, at: feedbackResponses.submittedAt })
      .from(feedbackResponses)
      .innerJoin(feedbackRequests, eq(feedbackRequests.id, feedbackResponses.requestId))
      .innerJoin(cohorts, eq(cohorts.id, feedbackRequests.cohortId))
      .where(gte(feedbackResponses.submittedAt, week))
      .orderBy(desc(feedbackResponses.submittedAt));
    const building = can("course:read")
      ? await tx
          .select({ id: qualifications.id, title: qualifications.title, saqaId: qualifications.saqaId })
          .from(qualifications)
          .where(inArray(qualifications.status, ["draft", "in_review"]))
          .orderBy(desc(qualifications.createdAt))
          .limit(5)
      : [];
    return { assess, moderate, coaches, responses, building, firstSubmission, firstLogbook };
  });

  const qualificationRows = await Promise.all(
    queues.building.map(async (row) => {
      const verification = await verificationOf(session, row.id);
      return {
        ...row,
        blocking: verification.units.reduce((sum, unit) => sum + unit.blocking.length, 0),
        toCheck: verification.units.reduce((sum, unit) => sum + unit.toCheck.length, 0),
      };
    }),
  );

  const appealsOpen = can("appeal:manage") ? await openAppeals(session) : [];
  const appealsLate = can("appeal:manage") ? await overdueAcknowledgements(session, now) : [];
  const unacknowledged = appealsOpen.filter((row) => !row.acknowledgedAt);

  // Each tile opens the items it counts (Roland, 8 October 2026): the item
  // itself when there is one, otherwise the list of them, at the right place.
  const urgent: AdminDashboard["urgent"] = [];
  if (leisa.length) {
    const leisaCohorts = [...new Set(leisa.map((row) => row.cohortId))];
    const href = !can("report:statutory")
      ? `/cohorts/${leisaCohorts[0]}`
      : leisaCohorts.length === 1
        ? `/cohorts/${leisaCohorts[0]}#leisa`
        : `/statutory/notify#${leisa.some((row) => row.state === "overdue") ? "overdue" : "soon"}`;
    urgent.push({ key: "leisa", count: leisa.length, href, on: leisaFirst, tone: leisa.some((row) => row.state !== "in_hand") ? "danger" : "warning" });
  }
  if (unacknowledged.length) {
    const href = unacknowledged.length === 1 ? `/appeals/${unacknowledged[0].id}` : "/appeals";
    urgent.push({ key: "appeals", count: unacknowledged.length, href, on: null, tone: appealsLate.length ? "danger" : "warning" });
  }
  // The marking and moderation pages are the assessor's and the moderator's.
  // An administrator who is neither is taken to where the work shows instead:
  // the learner's cohort results, or the tracker.
  const resultsOf = (userId: string) => {
    const cohortId = members.find((row) => row.userId === userId)?.cohortId;
    return cohortId ? `/cohorts/${cohortId}#results` : "/tracker";
  };
  const assessHref = can("assessment:assess")
    ? queues.assess.n === 1 && queues.firstSubmission ? `/assess/${queues.firstSubmission.id}` : "/assess"
    : queues.assess.n === 1 && queues.firstSubmission ? resultsOf(queues.firstSubmission.userId) : "/tracker";
  const moderateHref = can("assessment:moderate") ? "/moderate" : "/tracker";
  if (queues.assess.n) {
    const href = assessHref;
    urgent.push({ key: "toAssess", count: queues.assess.n, href, on: queues.assess.oldest ? iso(queues.assess.oldest) : null, tone: "warning" });
  }
  if (unmarked.length) {
    const oldest = unmarked[unmarked.length - 1];
    urgent.push({ key: "registers", count: unmarked.length, href: `/cohorts/${oldest.cohortId}/sessions/${oldest.id}`, on: oldest.date, tone: "warning" });
  }
  if (queues.coaches.n) {
    const href = queues.coaches.n === 1 && queues.firstLogbook ? `/workplace/${queues.firstLogbook.id}` : "/workplace";
    urgent.push({ key: "logbooks", count: queues.coaches.n, href, on: queues.coaches.oldest ? iso(queues.coaches.oldest) : null, tone: "plain" });
  }
  if (queues.moderate.n) {
    urgent.push({ key: "toModerate", count: queues.moderate.n, href: moderateHref, on: null, tone: "plain" });
  }

  return {
    urgent,
    running,
    setup,
    atRisk: atRisk.slice(0, 8),
    today: todays,
    due: due.slice(0, 8),
    qualifications: qualificationRows,
    waiting: { toAssess: queues.assess.n, toModerate: queues.moderate.n, withCoaches: queues.coaches.n, assessHref, moderateHref },
    feedback: {
      responses: queues.responses.length,
      cohortId: queues.responses[0]?.cohortId ?? null,
      cohortName: queues.responses[0]?.cohortName ?? null,
    },
  };
}
