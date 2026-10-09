import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  attendanceRecords,
  cohortMembers,
  cohortSessions,
  cohorts,
  formativeFeedback,
  moderationRecords,
  qualifications,
  users,
} from "@/db/schema";
import type { Translate } from "./i18n";
import { listAssessorQueue, listModerationQueue } from "./assessment";
import { openAppeals } from "./appeals";
import { listCohorts } from "./cohorts";
import type { DashRow, DashTile, DashTone, RoleDashboard } from "./dashboard-kit";
import { myEnrolments } from "./enrolment";
import { enrolmentReadiness } from "./enrolment-documents";
import { feedbackOwedBy } from "./feedback";
import { listInstruments } from "./fisa";
import { learnerQualifications } from "./learner-qualification";
import { listTenants, platformHealth } from "./provisioning";
import { listHeldAndAuthorised } from "./reassessment";
import { capabilityCoverage, headlineNumbers, overdueTraining, teamStatus } from "./reporting";
import { cohortCourseIds } from "./schedule";
import { cohortAttendance } from "./scheduling";
import type { AuthenticatedSession } from "./session";
import { blockedLearners, stepsForLearner } from "./spine";
import { cohortLeisa, notificationDue } from "./statutory-notification";
import { myLogbooks } from "./workplace";
import { coursesOf } from "./programme-staff";

/**
 * Every role's dashboard but the administrator's (job sheet D25), as designed
 * on the canvas on 8 October 2026. Roland: "Important that everything on the
 * dashboard is clickable and basically serves as a link to the actual item."
 * So each row names one thing and links to that thing, at a page the role may
 * open: a person without the marking permission is sent to where the work
 * shows, never to a refusal.
 *
 * The words are the catalogue's (rd.*); the builders are handed the reader's
 * translator and date writer, so each dashboard arrives ready to draw.
 */

export type Day = (date: string | Date, options?: { short?: boolean }) => string;
type Kit = { t: Translate; day: Day; now: Date };

const DAY = 24 * 60 * 60 * 1000;
const iso = (at: Date) => at.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY));
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY);
const fullName = (row: { firstName: string; lastName: string }) => `${row.firstName} ${row.lastName}`.trim();
const can = (session: AuthenticatedSession, permission: string) => session.permissions.includes(permission as never);

/** "Today", "1 day", "4 days": how long something has waited. */
function waited(t: Translate, since: Date | null, now: Date): { text: string; tone: DashTone } {
  if (!since) return { text: "", tone: "plain" };
  const days = Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY));
  return {
    text: days === 0 ? t("rd.today") : days === 1 ? t("rd.oneDay") : t("rd.days", { days }),
    tone: days >= 5 ? "danger" : days >= 2 ? "warning" : "plain",
  };
}

function tile(key: string, count: number, label: [string, string], detail: string, open: [string, string], href: string, tone: DashTone): DashTile {
  return { key, count, label: count === 1 ? label[0] : label[1], detail, open: count === 1 ? open[0] : open[1], href, tone };
}

function sessionName(t: Translate, row: { title: string | null; kind: string; sequence: number | null }) {
  if (row.title) return row.title;
  const kind = t(`session.kind.${row.kind as "lecture"}`);
  return row.sequence ? `${kind} ${row.sequence}` : kind;
}

/** Learners held up at a step, or absent from their cohort's last two sessions. */
async function learnersAtRisk(
  session: AuthenticatedSession,
  rows: { id: string; name: string; courseId: string | null; qualificationId: string | null }[],
  today: string,
): Promise<{ userId: string; name: string; cohortId: string; cohortName: string; reason: "blocked" | "absent"; detail: string }[]> {
  if (rows.length === 0) return [];
  const data = await withTenant(session.organisationId, async (tx) => {
    const ids = rows.map((row) => row.id);
    const members = await tx
      .select({ cohortId: cohortMembers.cohortId, userId: cohortMembers.userId, firstName: users.firstName, lastName: users.lastName })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(and(inArray(cohortMembers.cohortId, ids), isNull(cohortMembers.leftAt)));
    const past = await tx
      .select({ id: cohortSessions.id, cohortId: cohortSessions.cohortId, date: cohortSessions.scheduledDate })
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
    for (const row of rows) courses.set(row.id, await cohortCourseIds(tx, row));
    return { members, past, marks, courses };
  });

  const out: Awaited<ReturnType<typeof learnersAtRisk>> = [];
  for (const row of rows) {
    const mine = data.members.filter((member) => member.cohortId === row.id);
    const memberIds = new Set(mine.map((member) => member.userId));
    const seen = new Set<string>();
    const blocked = (await Promise.all((data.courses.get(row.id) ?? []).map((courseId) => blockedLearners(session, courseId)))).flat();
    for (const learner of blocked) {
      if (!memberIds.has(learner.userId) || seen.has(learner.userId)) continue;
      seen.add(learner.userId);
      out.push({ userId: learner.userId, name: fullName(learner), cohortId: row.id, cohortName: row.name, reason: "blocked", detail: learner.stepTitle });
    }
    const held = data.past.filter((one) => one.cohortId === row.id && data.marks.some((mark) => mark.sessionId === one.id)).slice(0, 2);
    if (held.length === 2) {
      for (const member of mine) {
        if (seen.has(member.userId)) continue;
        const absent = held.every((one) => data.marks.some((mark) => mark.sessionId === one.id && mark.userId === member.userId && mark.status === "absent"));
        if (absent) {
          seen.add(member.userId);
          out.push({ userId: member.userId, name: fullName(member), cohortId: row.id, cohortName: row.name, reason: "absent", detail: held.map((one) => one.date).reverse().join(",") });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Facilitator
// ---------------------------------------------------------------------------

export async function facilitatorDashboard(session: AuthenticatedSession, { t, day, now }: Kit): Promise<RoleDashboard> {
  const today = iso(now);
  const week = addDays(today, 7);
  const fortnight = addDays(today, 14);

  const all = (await listCohorts(session)).filter((row) => row.status !== "cancelled" && row.status !== "finished");
  const running = all.filter((row) => row.startDate <= today && (!row.endDate || row.endDate >= today));
  // The cohorts this facilitator is facilitator of, takes sessions for, or
  // whose programme names them (job sheet D27); all running ones if none.
  const sessionsTaken = await withTenant(session.organisationId, (tx) =>
    tx.selectDistinct({ cohortId: cohortSessions.cohortId }).from(cohortSessions).where(eq(cohortSessions.facilitatorId, session.userId)),
  );
  const namedOn = await coursesOf(session, session.userId, "facilitator");
  const facilitatorOf = await withTenant(session.organisationId, (tx) =>
    tx.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.facilitatorId, session.userId)),
  );
  const courseLists = await withTenant(session.organisationId, async (tx) => {
    const map = new Map<string, string[]>();
    for (const row of all) map.set(row.id, await cohortCourseIds(tx, row));
    return map;
  });
  const isTheirs = (row: (typeof all)[number]) =>
    sessionsTaken.some((one) => one.cohortId === row.id) ||
    facilitatorOf.some((one) => one.id === row.id) ||
    (courseLists.get(row.id) ?? []).some((courseId) => namedOn.has(courseId));
  const scope = all.some(isTheirs) ? all.filter(isTheirs) : running;
  const ids = scope.map((row) => row.id);
  const nameOf = (cohortId: string) => scope.find((row) => row.id === cohortId)?.name ?? "";

  const data = await withTenant(session.organisationId, async (tx) => {
    if (ids.length === 0) return { upcoming: [], unmarked: [], waiting: [], members: [] };
    const upcoming = await tx
      .select({ id: cohortSessions.id, cohortId: cohortSessions.cohortId, date: cohortSessions.scheduledDate, startTime: cohortSessions.startTime, title: cohortSessions.title, kind: cohortSessions.kind, sequence: cohortSessions.sequence, meetingUrl: cohortSessions.meetingUrl })
      .from(cohortSessions)
      .where(and(inArray(cohortSessions.cohortId, ids), gte(cohortSessions.scheduledDate, today), lte(cohortSessions.scheduledDate, fortnight), notInArray(cohortSessions.status, ["cancelled", "postponed"])))
      .orderBy(asc(cohortSessions.scheduledDate), asc(cohortSessions.startTime));
    const past = await tx
      .select({ id: cohortSessions.id, cohortId: cohortSessions.cohortId, date: cohortSessions.scheduledDate, title: cohortSessions.title, kind: cohortSessions.kind, sequence: cohortSessions.sequence })
      .from(cohortSessions)
      .where(and(inArray(cohortSessions.cohortId, ids), lt(cohortSessions.scheduledDate, today), notInArray(cohortSessions.status, ["cancelled", "postponed"]), ne(cohortSessions.kind, "walk_in")))
      .orderBy(asc(cohortSessions.scheduledDate));
    const marked = past.length
      ? await tx.selectDistinct({ sessionId: attendanceRecords.sessionId }).from(attendanceRecords).where(inArray(attendanceRecords.sessionId, past.map((row) => row.id)))
      : [];
    const members = await tx
      .select({ cohortId: cohortMembers.cohortId, userId: cohortMembers.userId })
      .from(cohortMembers)
      .where(and(inArray(cohortMembers.cohortId, ids), isNull(cohortMembers.leftAt)));
    const waiting = members.length
      ? await tx
          .select({ id: assessmentSubmissions.id, userId: assessmentSubmissions.userId, submittedAt: assessmentSubmissions.submittedAt, title: assessments.title, firstName: users.firstName, lastName: users.lastName })
          .from(assessmentSubmissions)
          .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
          .innerJoin(users, eq(users.id, assessmentSubmissions.userId))
          .where(and(eq(assessmentSubmissions.status, "submitted"), ne(assessments.purpose, "summative"), inArray(assessmentSubmissions.userId, members.map((row) => row.userId))))
          .orderBy(asc(assessmentSubmissions.submittedAt))
      : [];
    const unmarked = past.filter((row) => members.some((member) => member.cohortId === row.cohortId) && !marked.some((one) => one.sessionId === row.id));
    return { upcoming, unmarked, waiting, members };
  });

  const cohortOfLearner = (userId: string) => data.members.find((row) => row.userId === userId)?.cohortId ?? null;
  const markHref = (submissionId: string, userId: string) => {
    if (can(session, "assessment:assess")) return `/assess/${submissionId}/mark`;
    const cohortId = cohortOfLearner(userId);
    return cohortId ? `/cohorts/${cohortId}#results` : "/tracker";
  };
  const sessionHref = (row: { id: string; cohortId: string }) => `/cohorts/${row.cohortId}/sessions/${row.id}`;
  const todays = data.upcoming.filter((row) => row.date === today);
  const risk = await learnersAtRisk(session, scope.filter((row) => running.includes(row)), today);

  const cohortRows: DashRow[] = [];
  for (const row of scope) {
    const attendance = await cohortAttendance(session, row.id, now);
    const counted = attendance.learners.filter((line) => line.toDatePercent !== null);
    const average = attendance.countable > 0 && counted.length ? Math.round(counted.reduce((sum, line) => sum + (line.toDatePercent ?? 0), 0) / counted.length) : null;
    const span = row.endDate ? daysBetween(row.startDate, row.endDate) : null;
    const gone = daysBetween(row.startDate, today);
    cohortRows.push({
      primary: row.name,
      secondary: [row.courseTitle, t("rd.learners", { count: data.members.filter((member) => member.cohortId === row.id).length })].filter(Boolean).join(" · "),
      right: average === null ? undefined : t("rd.attendance", { percent: average }),
      href: `/cohorts/${row.id}`,
      bar: span && span > 0 && gone >= 0 ? Math.round((gone / span) * 100) : undefined,
    });
  }

  const tiles: DashTile[] = [];
  if (todays.length) tiles.push(tile("sessionsToday", todays.length, [t("rd.f.sessionToday"), t("rd.f.sessionsToday")], todays.map((row) => `${row.startTime ?? ""} ${sessionName(t, row)}`.trim()).join("; "), [t("rd.openOne"), t("rd.f.openSessions")], sessionHref(todays[0]), "warning"));
  if (data.unmarked.length) tiles.push(tile("registers", data.unmarked.length, [t("dash.urgent.registers.one"), t("dash.urgent.registers.many")], t("dash.urgent.registers.on", { date: day(data.unmarked[0].date) }), [t("rd.openOne"), t("dash.openMany.registers")], sessionHref(data.unmarked[0]), "danger"));
  // Someone who also assesses has the workbooks on their assessor's list.
  const marksToo = can(session, "assessment:assess");
  if (data.waiting.length && !marksToo) tiles.push(tile("workbooks", data.waiting.length, [t("rd.f.workbook"), t("rd.f.workbooks")], waited(t, data.waiting[0].submittedAt, now).text ? t("rd.oldestWaited", { time: waited(t, data.waiting[0].submittedAt, now).text }) : "", [t("rd.openOne"), t("rd.f.openWorkbooks")], data.waiting.length === 1 ? markHref(data.waiting[0].id, data.waiting[0].userId) : "#workbooks", "warning"));
  if (risk.length) tiles.push(tile("risk", risk.length, [t("rd.f.followUpOne"), t("rd.f.followUp")], t("rd.f.followUpNote"), [t("rd.openOne"), t("rd.f.openLearners")], risk.length === 1 ? `/people/${risk[0].userId}` : "#follow-up", "warning"));

  return {
    role: "instructor",
    tiles,
    main: [
      {
        id: "week",
        title: t("rd.f.week"),
        intro: t("rd.f.weekIntro"),
        empty: t("rd.f.weekNone"),
        rows: data.upcoming.filter((row) => row.date <= week).map((row) => ({
          primary: `${day(row.date)}${row.startTime ? ` ${row.startTime}` : ""} · ${sessionName(t, row)}`,
          secondary: nameOf(row.cohortId),
          right: row.date === today ? t("rd.today") : undefined,
          tone: "warning" as DashTone,
          href: sessionHref(row),
        })),
      },
      { id: "my-cohorts", title: t("rd.f.cohorts"), intro: t("rd.f.cohortsIntro"), empty: t("rd.f.cohortsNone"), rows: cohortRows, more: { label: t("dash.allCohorts"), href: "/cohorts" } },
      ...(marksToo ? [] : [{
        id: "workbooks",
        title: t("rd.f.waiting"),
        intro: can(session, "assessment:assess") ? t("rd.f.waitingIntro") : t("rd.f.waitingIntroView"),
        empty: t("rd.f.waitingNone"),
        rows: data.waiting.slice(0, 10).map((row) => {
          const age = waited(t, row.submittedAt, now);
          return { primary: `${fullName(row)} · ${row.title}`, secondary: nameOf(cohortOfLearner(row.userId) ?? ""), right: age.text, tone: age.tone, href: markHref(row.id, row.userId) };
        }),
      }]),
    ],
    side: [
      {
        id: "today-links",
        title: t("dash.timetable"),
        empty: t("dash.timetableNone"),
        rows: todays.map((row) =>
          row.meetingUrl
            ? { primary: t("dash.join"), secondary: `${sessionName(t, row)} · ${nameOf(row.cohortId)}`, right: row.startTime ?? "", href: row.meetingUrl, external: true }
            : { primary: t("dash.register"), secondary: `${sessionName(t, row)} · ${nameOf(row.cohortId)}`, right: row.startTime ?? "", href: sessionHref(row) },
        ),
      },
      {
        id: "follow-up",
        title: t("rd.f.followUpTitle"),
        intro: t("dash.riskIntro"),
        empty: t("dash.riskNone"),
        rows: risk.map((row) => ({
          primary: row.name,
          secondary: row.reason === "blocked" ? t("dash.why.blocked", { step: row.detail }) : t("dash.why.absent", { dates: row.detail.split(",").map((date) => day(date, { short: true })).join(", ") }),
          right: row.reason === "blocked" ? t("rd.heldUp") : t("rd.absent"),
          tone: row.reason === "absent" ? "danger" : "warning",
          href: can(session, "user:read") ? `/people/${row.userId}` : `/cohorts/${row.cohortId}#attendance`,
        })),
        more: { label: t("dash.tracker"), href: "/tracker" },
      },
      {
        id: "coming-up",
        title: t("rd.f.comingUp"),
        empty: t("rd.f.comingUpNone"),
        rows: data.upcoming
          .filter((row) => row.date > week || row.kind === "summative" || row.kind === "induction" || row.kind === "mock_eisa")
          .filter((row) => row.date > today)
          .slice(0, 6)
          .map((row) => ({ primary: sessionName(t, row), secondary: nameOf(row.cohortId), right: day(row.date, { short: true }), href: sessionHref(row) })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Assessor
// ---------------------------------------------------------------------------

export async function assessorDashboard(session: AuthenticatedSession, { t, day, now }: Kit): Promise<RoleDashboard> {
  const today = iso(now);
  const queue = (await listAssessorQueue(session)).filter((row) => row.learnerId !== session.userId);
  const held = can(session, "enrolment:read_all") ? await listHeldAndAuthorised(session) : [];
  const data = await withTenant(session.organisationId, async (tx) => {
    const referred = await tx
      .select({ submissionId: assessmentDecisions.submissionId, at: moderationRecords.actionedAt, comments: moderationRecords.comments, title: assessments.title, firstName: users.firstName, lastName: users.lastName })
      .from(moderationRecords)
      .innerJoin(assessmentDecisions, eq(assessmentDecisions.id, moderationRecords.decisionId))
      .innerJoin(assessmentSubmissions, eq(assessmentSubmissions.id, assessmentDecisions.submissionId))
      .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
      .innerJoin(users, eq(users.id, assessmentSubmissions.userId))
      .where(and(eq(assessmentDecisions.assessorId, session.userId), eq(moderationRecords.outcome, "referred_back"), gte(moderationRecords.actionedAt, new Date(now.getTime() - 60 * DAY))))
      .orderBy(desc(moderationRecords.actionedAt));
    const sittings = await tx
      .select({ id: cohortSessions.id, cohortId: cohortSessions.cohortId, cohortName: cohorts.name, date: cohortSessions.scheduledDate, startTime: cohortSessions.startTime, title: cohortSessions.title, kind: cohortSessions.kind, sequence: cohortSessions.sequence })
      .from(cohortSessions)
      .innerJoin(cohorts, eq(cohorts.id, cohortSessions.cohortId))
      .where(and(inArray(cohortSessions.kind, ["summative", "mock_eisa"]), gte(cohortSessions.scheduledDate, today), lte(cohortSessions.scheduledDate, addDays(today, 45)), notInArray(cohortSessions.status, ["cancelled", "postponed"])))
      .orderBy(asc(cohortSessions.scheduledDate))
      .limit(6);
    const [decided] = await tx
      .select({ n: count() })
      .from(assessmentDecisions)
      .where(and(eq(assessmentDecisions.assessorId, session.userId), gte(assessmentDecisions.signedAt, new Date(now.getTime() - 7 * DAY))));
    return { referred, sittings, decided: decided.n };
  });
  const authorised = held.filter((row) => row.awaitingOral);
  // The assessor's own programmes first (job sheet D27); nothing is hidden.
  const mine = await coursesOf(session, session.userId, "assessor");
  const courseOf = await withTenant(session.organisationId, async (tx) => {
    const ids = [...new Set(queue.map((row) => row.assessmentId))];
    const rows = ids.length ? await tx.select({ id: assessments.id, courseId: assessments.courseId }).from(assessments).where(inArray(assessments.id, ids)) : [];
    return new Map(rows.map((row) => [row.id, row.courseId]));
  });
  const isMine = (row: (typeof queue)[number]) => mine.has(courseOf.get(row.assessmentId) ?? "");
  const ownFirst = (rows: typeof queue) => [...rows.filter(isMine), ...rows.filter((row) => !isMine(row))];
  const summatives = ownFirst(queue.filter((row) => row.purpose === "summative"));
  const workbooks = ownFirst(queue.filter((row) => row.purpose !== "summative"));

  const queueRow = (row: (typeof queue)[number]): DashRow => {
    const age = waited(t, row.submittedAt, now);
    return {
      primary: `${row.learnerFirstName} ${row.learnerLastName} · ${row.assessmentTitle}${row.attemptNumber > 1 ? `, ${t("rd.attempt", { n: row.attemptNumber })}` : ""}`,
      secondary: [isMine(row) ? t("rd.yours") : null, row.courseTitle, row.submittedAt ? t("rd.handedIn", { date: day(row.submittedAt) }) : null].filter(Boolean).join(" · "),
      right: age.text,
      tone: age.tone,
      href: row.purpose === "summative" ? `/assess/${row.submissionId}` : `/assess/${row.submissionId}/mark`,
    };
  };

  const tiles: DashTile[] = [];
  if (summatives.length) tiles.push(tile("summatives", summatives.length, [t("rd.a.summative"), t("rd.a.summatives")], t("rd.oldestWaited", { time: waited(t, summatives[0].submittedAt, now).text || t("rd.today") }), [t("rd.openOne"), t("rd.a.openQueue")], summatives.length === 1 ? queueRow(summatives[0]).href : "#to-assess", "warning"));
  if (workbooks.length) tiles.push(tile("workbooksToMark", workbooks.length, [t("rd.f.workbook"), t("rd.f.workbooks")], t("rd.oldestWaited", { time: waited(t, workbooks[0].submittedAt, now).text || t("rd.today") }), [t("rd.openOne"), t("rd.f.openWorkbooks")], workbooks.length === 1 ? queueRow(workbooks[0]).href : "#workbooks-to-mark", "plain"));
  if (data.referred.length) tiles.push(tile("referred", data.referred.length, [t("rd.a.referredOne"), t("rd.a.referred")], t("rd.a.referredNote"), [t("rd.openOne"), t("rd.a.openReferred")], data.referred.length === 1 ? `/assess/${data.referred[0].submissionId}` : "#referred", "danger"));
  if (authorised.length) tiles.push(tile("orals", authorised.length, [t("rd.a.oralOne"), t("rd.a.orals")], t("rd.a.oralNote"), [t("rd.openOne"), t("rd.a.openOrals")], "/reassessments", "plain"));

  return {
    role: "assessor",
    tiles,
    main: [
      { id: "to-assess", title: t("rd.a.queue"), intro: t("rd.a.queueIntro"), empty: t("rd.a.queueNone"), rows: summatives.map(queueRow), more: { label: t("rd.a.allSubmissions"), href: "/assess" } },
      { id: "workbooks-to-mark", title: t("rd.a.workbooks"), intro: t("rd.a.workbooksIntro"), empty: t("rd.f.waitingNone"), rows: workbooks.slice(0, 10).map(queueRow) },
      {
        id: "referred",
        title: t("rd.a.referredTitle"),
        intro: t("rd.a.referredIntro"),
        empty: t("rd.a.referredNone"),
        rows: data.referred.map((row) => ({ primary: `${fullName(row)} · ${row.title}`, secondary: row.comments ?? undefined, right: day(row.at, { short: true }), tone: "danger" as DashTone, href: `/assess/${row.submissionId}` })),
      },
    ],
    side: [
      {
        id: "orals",
        title: t("rd.a.oralsTitle"),
        intro: t("rd.a.oralsIntro"),
        empty: t("rd.a.oralsNone"),
        rows: held.slice(0, 8).map((row) => ({ primary: `${fullName(row)} · ${row.assessmentTitle}`, secondary: row.awaitingOral ? t("rd.a.authorised") : t("rd.a.held"), right: row.awaitingOral ? t("rd.a.toArrange") : "", tone: "warning" as DashTone, href: "/reassessments" })),
      },
      {
        id: "sittings",
        title: t("rd.a.sittings"),
        intro: t("rd.a.sittingsIntro"),
        empty: t("rd.a.sittingsNone"),
        rows: data.sittings.map((row) => ({ primary: sessionName(t, row), secondary: row.cohortName, right: day(row.date, { short: true }), href: `/cohorts/${row.cohortId}/sessions/${row.id}` })),
      },
      {
        id: "decided",
        title: t("rd.a.decided"),
        empty: t("rd.a.decidedNone"),
        rows: data.decided ? [{ primary: t("rd.a.decidedCount", { count: data.decided }), secondary: t("rd.a.decidedNote"), href: "/assess" }] : [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Moderator
// ---------------------------------------------------------------------------

export async function moderatorDashboard(session: AuthenticatedSession, { t, day, now }: Kit): Promise<RoleDashboard> {
  const sampled = await listModerationQueue(session);
  // The moderator's own programmes first (job sheet D27); nothing is hidden.
  const mine = await coursesOf(session, session.userId, "moderator");
  const courseOf = await withTenant(session.organisationId, async (tx) => {
    const ids = sampled.map((row) => row.submissionId);
    const rows = ids.length
      ? await tx
          .select({ id: assessmentSubmissions.id, courseId: assessments.courseId })
          .from(assessmentSubmissions)
          .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
          .where(inArray(assessmentSubmissions.id, ids))
      : [];
    return new Map(rows.map((row) => [row.id, row.courseId]));
  });
  const isMine = (row: (typeof sampled)[number]) => mine.has(courseOf.get(row.submissionId) ?? "");
  const queue = [...sampled.filter(isMine), ...sampled.filter((row) => !isMine(row))];
  const papers = (await listInstruments(session)).filter((row) => row.status === "in_moderation" || row.status === "draft");
  const appeals = can(session, "appeal:manage") ? (await openAppeals(session)).filter((row) => row.ground === "result") : [];
  const packs = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ assessmentId: assessments.id, title: assessments.title, moderated: count() })
      .from(moderationRecords)
      .innerJoin(assessmentDecisions, eq(assessmentDecisions.id, moderationRecords.decisionId))
      .innerJoin(assessmentSubmissions, eq(assessmentSubmissions.id, assessmentDecisions.submissionId))
      .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
      .groupBy(assessments.id, assessments.title)
      .orderBy(asc(assessments.title))
      .limit(8),
  );
  const inModeration = papers.filter((row) => row.status === "in_moderation");

  const tiles: DashTile[] = [];
  if (queue.length) tiles.push(tile("sampled", queue.length, [t("rd.m.sampledOne"), t("rd.m.sampled")], t("rd.oldestWaited", { time: waited(t, queue[0].queuedAt, now).text || t("rd.today") }), [t("rd.openOne"), t("rd.m.openSample")], queue.length === 1 ? `/moderate#decision-${queue[0].decisionId}` : "/moderate", "warning"));
  if (inModeration.length) tiles.push(tile("papers", inModeration.length, [t("rd.m.paperOne"), t("rd.m.papers")], t("rd.m.papersNote"), [t("rd.openOne"), t("rd.m.openPapers")], inModeration.length === 1 ? `/fisa/${inModeration[0].id}` : "#fisa", "warning"));
  if (appeals.length) tiles.push(tile("appealsResult", appeals.length, [t("rd.m.appealOne"), t("rd.m.appeals")], t("rd.m.appealsNote"), [t("rd.openOne"), t("rd.m.openAppeals")], appeals.length === 1 ? `/appeals/${appeals[0].id}` : "#appeals", "danger"));

  return {
    role: "moderator",
    tiles,
    main: [
      {
        id: "sampled",
        title: t("rd.m.sampledTitle"),
        intro: t("rd.m.sampledIntro"),
        empty: t("rd.m.sampledNone"),
        rows: queue.map((row) => ({
          primary: `${row.assessmentTitle}${row.courseTitle ? ` · ${row.courseTitle}` : ""}`,
          secondary: [isMine(row) ? t("rd.yours") : null, t("rd.m.assessedBy", { name: `${row.assessorFirstName} ${row.assessorLastName}`, reason: row.samplingReason })].filter(Boolean).join(" · "),
          right: day(row.queuedAt, { short: true }),
          href: `/moderate#decision-${row.decisionId}`,
        })),
        more: { label: t("rd.m.allSampled"), href: "/moderate" },
      },
      {
        id: "fisa",
        title: t("rd.m.fisa"),
        intro: t("rd.m.fisaIntro"),
        empty: t("rd.m.fisaNone"),
        rows: papers.map((row) => ({
          primary: `${row.title}, ${t("rd.m.version", { version: row.version })}`,
          secondary: [row.programme, row.saqaId].filter(Boolean).join(" · "),
          right: row.status === "in_moderation" ? t("rd.m.withYou") : t("rd.m.draft"),
          tone: row.status === "in_moderation" ? "warning" : "plain",
          href: `/fisa/${row.id}`,
        })),
      },
      {
        id: "appeals",
        title: t("rd.m.appealsTitle"),
        empty: t("rd.m.appealsNone"),
        rows: appeals.map((row) => ({ primary: `${row.learnerName}${row.assessmentTitle ? ` · ${row.assessmentTitle}` : ""}`, secondary: row.cohortName, right: day(row.lodgedAt, { short: true }), tone: "danger" as DashTone, href: `/appeals/${row.id}` })),
      },
    ],
    side: [
      {
        id: "packs",
        title: t("rd.m.packs"),
        intro: t("rd.m.packsIntro"),
        empty: t("rd.m.packsNone"),
        rows: packs.map((row) => ({ primary: row.title, secondary: t("rd.m.moderatedCount", { count: row.moderated }), href: `/moderate/pack/${row.assessmentId}` })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------------

export async function learnerDashboard(session: AuthenticatedSession, { t, day, now }: Kit): Promise<RoleDashboard> {
  const today = iso(now);
  const [enrolled, owed, qualificationsHeld] = await Promise.all([myEnrolments(session), feedbackOwedBy(session, session.userId), learnerQualifications(session)]);
  const home = qualificationsHeld[0] ? `/learn/qualification/${qualificationsHeld[0].id}` : "/";

  const data = await withTenant(session.organisationId, async (tx) => {
    const classes = await tx
      .select({ id: cohortSessions.id, date: cohortSessions.scheduledDate, startTime: cohortSessions.startTime, title: cohortSessions.title, kind: cohortSessions.kind, sequence: cohortSessions.sequence, meetingUrl: cohortSessions.meetingUrl, venue: cohortSessions.venue, cohortName: cohorts.name })
      .from(cohortSessions)
      .innerJoin(cohorts, eq(cohorts.id, cohortSessions.cohortId))
      .innerJoin(cohortMembers, and(eq(cohortMembers.cohortId, cohortSessions.cohortId), eq(cohortMembers.userId, session.userId), isNull(cohortMembers.leftAt)))
      .where(and(gte(cohortSessions.scheduledDate, today), lte(cohortSessions.scheduledDate, addDays(today, 14)), notInArray(cohortSessions.status, ["cancelled", "postponed"])))
      .orderBy(asc(cohortSessions.scheduledDate), asc(cohortSessions.startTime))
      .limit(5);
    const returned = await tx
      .select({ enrolmentId: assessmentSubmissions.enrolmentId, assessmentId: assessmentSubmissions.assessmentId, title: assessments.title, at: formativeFeedback.returnedAt })
      .from(formativeFeedback)
      .innerJoin(assessmentSubmissions, eq(assessmentSubmissions.id, formativeFeedback.submissionId))
      .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
      .where(and(eq(assessmentSubmissions.userId, session.userId), gte(formativeFeedback.returnedAt, new Date(now.getTime() - 21 * DAY))))
      .orderBy(desc(formativeFeedback.returnedAt))
      .limit(5);
    const decided = await tx
      .select({ enrolmentId: assessmentSubmissions.enrolmentId, assessmentId: assessmentSubmissions.assessmentId, title: assessments.title, outcome: assessmentDecisions.outcome, at: assessmentDecisions.signedAt })
      .from(assessmentDecisions)
      .innerJoin(assessmentSubmissions, eq(assessmentSubmissions.id, assessmentDecisions.submissionId))
      .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
      .where(eq(assessmentSubmissions.userId, session.userId))
      .orderBy(desc(assessmentDecisions.signedAt))
      .limit(5);
    return { classes, returned, decided };
  });

  // What is open now, and when each is due, across everything the learner is on.
  const open: (DashRow & { due: number })[] = [];
  for (const enrolment of enrolled.filter((row) => row.status !== "completed")) {
    const steps = await stepsForLearner(session, enrolment.courseId, session.userId).catch(() => []);
    // A course of lessons alone has no steps: it is the course itself to carry on with.
    if (steps.length === 0) {
      const late = enrolment.dueDate ? enrolment.dueDate.getTime() < now.getTime() : false;
      open.push({
        primary: enrolment.courseTitle,
        secondary: t("rd.l.lessons", { done: enrolment.completedLessons, total: enrolment.totalLessons }),
        right: enrolment.dueDate ? (late ? t("rd.l.wasDue", { date: day(enrolment.dueDate, { short: true }) }) : day(enrolment.dueDate, { short: true })) : t("rd.l.openNow"),
        tone: late ? "danger" : "plain",
        href: `/learn/${enrolment.enrolmentId}`,
        bar: enrolment.totalLessons ? Math.round((enrolment.completedLessons / enrolment.totalLessons) * 100) : undefined,
        due: enrolment.dueDate ? enrolment.dueDate.getTime() : Number.MAX_SAFE_INTEGER,
      });
      continue;
    }
    for (const step of steps) {
      if (!step.open || step.state === "done") continue;
      const href = step.kind === "assessment" ? (step.hasPaper ? `/learn/${enrolment.enrolmentId}/paper/${step.targetId}` : `/learn/${enrolment.enrolmentId}/assessment/${step.targetId}`) : `/learn/${enrolment.enrolmentId}`;
      const late = step.dueAt ? step.dueAt.getTime() < now.getTime() : false;
      open.push({
        primary: step.title,
        secondary: enrolment.courseTitle,
        right: step.dueAt ? (late ? t("rd.l.wasDue", { date: day(step.dueAt, { short: true }) }) : day(step.dueAt, { short: true })) : t("rd.l.openNow"),
        tone: late ? "danger" : step.dueAt && step.dueAt.getTime() - now.getTime() < 7 * DAY ? "warning" : "plain",
        href,
        due: step.dueAt ? step.dueAt.getTime() : Number.MAX_SAFE_INTEGER,
      });
    }
  }
  open.sort((a, b) => a.due - b.due);
  const dueSoon = open.filter((row) => row.due !== Number.MAX_SAFE_INTEGER && row.due - now.getTime() < 7 * DAY);

  const onQualification = qualificationsHeld.length > 0;
  const documents = onQualification ? await enrolmentReadiness(session, session.userId, "standard_qualification", now).catch(() => null) : null;
  const missing = documents ? documents.documents.filter((row) => !row.satisfied) : [];
  const todays = data.classes.filter((row) => row.date === today);
  const classHref = (row: (typeof data.classes)[number]) => row.meetingUrl ?? home;
  const resultHref = (row: { enrolmentId: string | null; assessmentId: string }) => (row.enrolmentId ? `/learn/${row.enrolmentId}/assessment/${row.assessmentId}` : home);

  const tiles: DashTile[] = [];
  if (todays.length) tiles.push({ ...tile("classToday", todays.length, [t("rd.l.classToday"), t("rd.l.classesToday")], `${todays[0].startTime ?? ""} ${sessionName(t, todays[0])}`.trim(), [todays[0].meetingUrl ? t("dash.join") : t("rd.openOne"), t("rd.l.openClasses")], classHref(todays[0]), "warning") });
  if (dueSoon.length) tiles.push(tile("dueSoon", dueSoon.length, [t("rd.l.dueOne"), t("rd.l.due")], dueSoon[0].right ?? "", [t("rd.openOne"), t("rd.l.openDue")], dueSoon.length === 1 ? dueSoon[0].href : "#due-next", dueSoon.some((row) => row.tone === "danger") ? "danger" : "warning"));
  if (data.returned.length) tiles.push(tile("feedbackBack", data.returned.length, [t("rd.l.feedbackOne"), t("rd.l.feedback")], data.returned[0].title, [t("rd.l.read"), t("rd.l.openFeedback")], data.returned.length === 1 ? resultHref(data.returned[0]) : "#results", "plain"));
  if (owed.length) tiles.push(tile("forms", owed.length, [t("rd.l.formOne"), t("rd.l.forms")], owed[0].assessmentTitle ?? owed[0].cohortName, [t("rd.l.fillIn"), t("rd.l.openForms")], `/feedback/${owed[0].id}`, "warning"));
  if (missing.length) tiles.push(tile("documents", missing.length, [t("rd.l.documentOne"), t("rd.l.documents")], missing.map((row) => row.label).join(", "), [t("rd.l.supply"), t("rd.l.supply")], "/enrolment-form", "danger"));

  const outcomeWord = (outcome: string) => t(`rd.outcome.${outcome as "competent"}`);

  return {
    role: "learner",
    tiles,
    main: [
      { id: "due-next", title: t("rd.l.dueTitle"), intro: t("rd.l.dueIntro"), empty: t("rd.l.dueNone"), rows: open.slice(0, 8) },
    ],
    side: [
      {
        id: "classes",
        title: t("rd.l.classes"),
        empty: t("rd.l.classesNone"),
        rows: data.classes.map((row) => ({
          primary: sessionName(t, row),
          secondary: row.meetingUrl ? t("rd.l.join") : row.venue ?? row.cohortName,
          right: row.date === today ? `${t("rd.today")} ${row.startTime ?? ""}`.trim() : day(row.date, { short: true }),
          tone: row.date === today ? "warning" : "plain",
          href: classHref(row),
          external: Boolean(row.meetingUrl),
        })),
      },
      {
        id: "results",
        title: t("rd.l.results"),
        empty: t("rd.l.resultsNone"),
        rows: [
          ...data.returned.map((row) => ({ primary: row.title, secondary: t("rd.l.feedbackFrom"), right: t("rd.new"), tone: "warning" as DashTone, href: resultHref(row) })),
          ...data.decided.map((row) => ({ primary: row.title, secondary: outcomeWord(row.outcome), right: day(row.at, { short: true }), tone: (row.outcome === "competent" ? "good" : "plain") as DashTone, href: resultHref(row) })),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Workplace coach
// ---------------------------------------------------------------------------

export async function coachDashboard(session: AuthenticatedSession, { t, day, now }: Kit): Promise<RoleDashboard> {
  const books = (await myLogbooks(session)).filter((row) => row.coachId === session.userId);
  const toSign = books.filter((row) => row.status === "submitted_to_coach").sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));
  const returned = books.filter((row) => row.status === "returned_by_coach");
  const signed = books.filter((row) => row.status === "coach_signed" || row.status === "accepted_by_assessor");
  const stage = (status: string) => t(`wem.stage.${status as "draft"}`);
  const row = (book: (typeof books)[number]): DashRow => {
    const age = book.status === "submitted_to_coach" ? waited(t, book.submittedAt, now) : { text: stage(book.status), tone: "plain" as DashTone };
    return { primary: `${book.learnerFirst} ${book.learnerLast} · ${book.moduleCode}`, secondary: `${book.moduleTitle} · ${book.employerName}`, right: age.text, tone: age.tone, href: `/workplace/${book.id}` };
  };

  const tiles: DashTile[] = [];
  if (toSign.length) tiles.push(tile("toSign", toSign.length, [t("rd.c.signOne"), t("rd.c.sign")], toSign[0].submittedAt ? t("rd.c.sentOn", { date: day(toSign[0].submittedAt) }) : "", [t("rd.openOne"), t("rd.c.openSign")], toSign.length === 1 ? `/workplace/${toSign[0].id}` : "#to-sign", "danger"));
  if (returned.length) tiles.push(tile("returned", returned.length, [t("rd.c.returnedOne"), t("rd.c.returned")], t("rd.c.returnedNote"), [t("rd.openOne"), t("rd.c.openReturned")], returned.length === 1 ? `/workplace/${returned[0].id}` : "#learners", "plain"));

  return {
    role: "workplace_coach",
    tiles,
    main: [
      { id: "to-sign", title: t("rd.c.signTitle"), intro: t("rd.c.signIntro"), empty: t("rd.c.signNone"), rows: toSign.map(row) },
      { id: "learners", title: t("rd.c.learners"), intro: t("rd.c.learnersIntro"), empty: t("rd.c.learnersNone"), rows: books.filter((book) => book.status !== "submitted_to_coach").map(row) },
    ],
    side: [
      { id: "signed", title: t("rd.c.signed"), empty: t("rd.c.signedNone"), rows: signed.slice(0, 6).map((book) => ({ ...row(book), right: book.coachSignedAt ? day(book.coachSignedAt, { short: true }) : stage(book.status), tone: "good" as DashTone })) },
      { id: "agreements", title: t("rd.c.agreements"), empty: t("rd.c.agreementsNone"), rows: [...new Set(books.map((book) => book.employerName))].map((employer) => ({ primary: employer, secondary: t("rd.learners", { count: new Set(books.filter((book) => book.employerName === employer).map((book) => book.learnerId)).size }), href: "/workplace" })) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Line manager
// ---------------------------------------------------------------------------

export async function managerDashboard(session: AuthenticatedSession, { t, day }: Kit): Promise<RoleDashboard> {
  const [team, overdue, coverage] = await Promise.all([teamStatus(session), overdueTraining(session), capabilityCoverage(session)]);
  const gaps = coverage.filter((row) => row.noCoverage || row.singlePointOfFailure);

  const tiles: DashTile[] = [];
  if (overdue.length) tiles.push(tile("overdueTraining", overdue.length, [t("rd.lm.overdueOne"), t("rd.lm.overdue")], t("rd.lm.overdueNote"), [t("rd.openOne"), t("rd.lm.openOverdue")], "/reports#overdue", "danger"));
  const single = gaps.filter((row) => row.singlePointOfFailure);
  if (single.length) tiles.push(tile("single", single.length, [t("rd.lm.singleOne"), t("rd.lm.single")], single.map((row) => row.name).join(", "), [t("rd.openOne"), t("rd.lm.openCoverage")], "/reports#coverage", "warning"));

  return {
    role: "line_manager",
    tiles,
    main: [
      {
        id: "team",
        title: t("rd.lm.team"),
        intro: t("rd.lm.teamIntro"),
        empty: t("rd.lm.teamNone"),
        rows: team.map((person) => ({
          primary: fullName(person),
          secondary: [person.jobTitle, t("rd.lm.counts", { completed: person.completed, total: person.enrolments })].filter(Boolean).join(" · "),
          right: person.overdue ? t("rd.lm.overdueCount", { count: person.overdue }) : t("rd.lm.onTrack"),
          tone: person.overdue ? "danger" : "good",
          href: person.overdue ? "/reports#overdue" : "/reports#by-course",
          bar: person.enrolments ? Math.round((person.completed / person.enrolments) * 100) : undefined,
        })),
        more: { label: t("rd.lm.reports"), href: "/reports" },
      },
      {
        id: "coverage",
        title: t("rd.lm.coverage"),
        intro: t("rd.lm.coverageIntro"),
        empty: t("rd.lm.coverageNone"),
        more: { label: t("rd.lm.allCoverage"), href: "/reports#coverage" },
        rows: [...gaps].sort((a, b) => Number(b.singlePointOfFailure) - Number(a.singlePointOfFailure)).slice(0, 6).map((row) => ({ primary: row.name, secondary: row.noCoverage ? t("rd.lm.nobody") : t("rd.lm.onePerson"), right: row.noCoverage ? t("rd.lm.gap") : t("rd.lm.singleShort"), tone: row.noCoverage ? "danger" : "warning", href: "/reports#coverage", bar: row.coverage })),
      },
    ],
    side: [
      { id: "overdue", title: t("rd.lm.overdueTitle"), empty: t("rd.lm.overdueNone"), rows: overdue.slice(0, 8).map((row) => ({ primary: fullName(row), secondary: row.courseTitle, right: row.dueDate ? day(row.dueDate, { short: true }) : "", tone: "danger" as DashTone, href: "/reports#overdue" })) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Skills development facilitator
// ---------------------------------------------------------------------------

export async function sdfDashboard(session: AuthenticatedSession, { t, day, now }: Kit, leisaTargetHours: number | null): Promise<RoleDashboard> {
  const today = iso(now);
  const due = (await notificationDue(session, today)).filter((row) => row.cohortId && row.state !== "notified");
  const counted = due.filter((row) => row.state !== "no_induction");
  const cohortIds = [...new Set(counted.map((row) => row.cohortId!))];
  const gaps: DashRow[] = [];
  for (const cohortId of cohortIds) {
    const leisa = await cohortLeisa(session, cohortId);
    for (const learner of [...new Set(leisa.problems.map((problem) => problem.learner))]) {
      const userId = leisa.due.find((row) => `${row.firstName} ${row.lastName}` === learner)?.userId;
      const fields = leisa.problems.filter((problem) => problem.learner === learner).map((problem) => problem.field);
      gaps.push({ primary: learner, secondary: fields.slice(0, 4).join(", ") + (fields.length > 4 ? ` ${t("rd.s.more", { count: fields.length - 4 })}` : ""), right: t("rd.s.fields", { count: fields.length }), tone: "warning", href: userId ? `/enrolment-form?learner=${userId}` : `/cohorts/${cohortId}#leisa` });
    }
  }
  const headline = await headlineNumbers(session);

  const perCohort: DashRow[] = cohortIds.map((cohortId) => {
    const rows = counted.filter((row) => row.cohortId === cohortId);
    const limit = rows.map((row) => row.dueOn).filter((d): d is string => Boolean(d)).sort()[0];
    const induction = rows.map((row) => row.inductionOn).filter((d): d is string => Boolean(d)).sort()[0];
    const target = leisaTargetHours && induction ? addDays(induction, Math.ceil(leisaTargetHours / 24)) : null;
    const shown = target && limit && target < limit && target >= today ? target : limit;
    const late = Boolean(shown && shown < today);
    return {
      primary: t("rd.s.leisaFor", { cohort: rows[0].cohortName ?? "" }),
      secondary: target && shown === target ? t("rd.s.yourTarget", { count: rows.length }) : t("rd.s.limit", { count: rows.length }),
      right: shown ? (late ? t("rd.l.wasDue", { date: day(shown, { short: true }) }) : day(shown, { short: true })) : "",
      tone: late ? "danger" : "warning",
      href: `/cohorts/${cohortId}#leisa`,
    };
  });

  const tiles: DashTile[] = [];
  if (counted.length) tiles.push(tile("leisa", counted.length, [t("dash.urgent.leisa.one"), t("dash.urgent.leisa.many")], perCohort[0]?.right ?? "", [t("rd.openOne"), t("rd.s.openLeisa")], cohortIds.length === 1 ? `/cohorts/${cohortIds[0]}#leisa` : `/statutory/notify#${counted.some((row) => row.state === "overdue") ? "overdue" : "soon"}`, counted.some((row) => row.state === "overdue") ? "danger" : "warning"));
  if (gaps.length) tiles.push(tile("statutoryGaps", gaps.length, [t("rd.s.gapOne"), t("rd.s.gaps")], t("rd.s.gapsNote"), [t("rd.openOne"), t("rd.s.openGaps")], gaps.length === 1 ? gaps[0].href : "#statutory-gaps", "warning"));
  const noInduction = due.filter((row) => row.state === "no_induction");
  if (noInduction.length) tiles.push(tile("noInduction", noInduction.length, [t("rd.s.noInductionOne"), t("rd.s.noInduction")], t("rd.s.noInductionNote"), [t("rd.openOne"), t("rd.s.openNoInduction")], "/statutory/notify#no-induction", "plain"));

  return {
    role: "skills_development_facilitator",
    tiles,
    main: [
      { id: "returns", title: t("rd.s.returns"), intro: t("rd.s.returnsIntro"), empty: t("rd.s.returnsNone"), rows: [...perCohort, { primary: t("rd.s.wsp"), secondary: t("rd.s.wspNote"), href: "/statutory" }] },
      { id: "statutory-gaps", title: t("rd.s.gapsTitle"), intro: t("rd.s.gapsIntro"), empty: t("rd.s.gapsNone"), rows: gaps },
    ],
    side: [
      {
        id: "this-year",
        title: t("rd.s.year"),
        intro: t("rd.s.yearIntro"),
        empty: "",
        rows: [
          { primary: t("rd.s.people", { count: headline.people }), secondary: t("rd.s.enrolments", { count: headline.enrolments }), href: "/reports" },
          { primary: t("rd.s.completed", { count: headline.completed }), secondary: t("rd.s.certificates", { count: headline.certificates }), href: "/reports" },
        ],
      },
      { id: "submissions", title: t("rd.s.sent"), empty: "", rows: [{ primary: t("enrolNotify.submissions"), secondary: t("rd.s.sentNote"), href: "/statutory/notify#submissions" }] },
    ],
  };
}

// ---------------------------------------------------------------------------
// External verifier
// ---------------------------------------------------------------------------

export async function verifierDashboard(session: AuthenticatedSession, { t, day }: Kit): Promise<RoleDashboard> {
  const all = await listCohorts(session);
  const open = all.filter((row) => row.status !== "cancelled");
  const live = await withTenant(session.organisationId, (tx) =>
    tx.select({ id: qualifications.id, title: qualifications.title, saqaId: qualifications.saqaId }).from(qualifications).where(eq(qualifications.status, "published")).orderBy(asc(qualifications.title)),
  );

  return {
    role: "external_verifier",
    heading: { title: t("rd.v.openToYou"), intro: t("rd.v.openToYouIntro") },
    tiles: [
      tile("vCohorts", open.length, [t("rd.v.cohortOne"), t("rd.v.cohorts")], t("rd.v.cohortsNote"), [t("rd.openOne"), t("rd.v.openCohorts")], open.length === 1 ? `/cohorts/${open[0].id}/file` : "#cohort-files", "plain"),
      tile("vReadiness", open.length, [t("rd.v.readinessOne"), t("rd.v.readinessMany")], t("rd.v.readinessIntro"), [t("rd.openOne"), t("rd.v.openReadiness")], open.length === 1 ? `/eisa/${open[0].id}` : "#readiness", "plain"),
    ],
    main: [
      {
        id: "cohort-files",
        title: t("rd.v.files"),
        intro: t("rd.v.filesIntro"),
        empty: t("rd.v.filesNone"),
        rows: open.map((row) => ({ primary: row.name, secondary: row.courseTitle ?? undefined, right: day(row.startDate, { short: true }), href: `/cohorts/${row.id}/file` })),
      },
      {
        id: "readiness",
        title: t("rd.v.readiness"),
        intro: t("rd.v.readinessIntro"),
        empty: t("rd.v.filesNone"),
        rows: open.map((row) => ({ primary: row.name, secondary: t("rd.v.readinessRow"), href: `/eisa/${row.id}` })),
      },
    ],
    side: [
      { id: "live-qualifications", title: t("rd.v.qualifications"), empty: t("rd.v.qualificationsNone"), rows: live.map((row) => ({ primary: row.title, secondary: row.saqaId ? `SAQA ${row.saqaId}` : undefined, href: "/cohorts" })) },
      { id: "read-only", title: t("rd.v.readOnly"), intro: t("rd.v.readOnlyIntro"), empty: "", rows: [{ primary: t("rd.v.records"), secondary: t("rd.v.recordsNote"), href: "/records" }] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Platform owner
// ---------------------------------------------------------------------------

export async function platformDashboard(session: AuthenticatedSession, { t }: Kit): Promise<RoleDashboard> {
  const tenants = await listTenants(session);
  const health = can(session, "platform:view_health") ? await platformHealth(session) : null;
  const withoutAdmin = tenants.filter((row) => row.administrators === 0 && row.status === "active");

  const tiles: DashTile[] = [];
  if (withoutAdmin.length) tiles.push(tile("noAdmin", withoutAdmin.length, [t("rd.p.noAdminOne"), t("rd.p.noAdmin")], withoutAdmin.map((row) => row.displayName).join(", "), [t("rd.openOne"), t("rd.p.openOrganisations")], `/platform#tenant-${withoutAdmin[0].id}`, "danger"));
  tiles.push(tile("organisations", tenants.length, [t("rd.p.orgOne"), t("rd.p.orgs")], health ? t("rd.p.active", { count: health.activeTenants }) : "", [t("rd.openOne"), t("rd.p.openOrganisations")], "/platform", "plain"));

  return {
    role: "platform_owner",
    tiles,
    main: [
      {
        id: "organisations",
        title: t("rd.p.title"),
        intro: t("rd.p.intro"),
        empty: t("rd.p.none"),
        rows: tenants.map((row) => ({
          primary: row.displayName,
          secondary: t("rd.p.usage", { people: row.people, enrolments: row.enrolments }),
          right: row.administrators === 0 ? t("rd.p.needsAdmin") : t(`rd.p.status.${row.status as "active"}`),
          tone: row.administrators === 0 ? "danger" : row.status === "active" ? "good" : "plain",
          href: `/platform#tenant-${row.id}`,
        })),
      },
    ],
    side: health
      ? [
          {
            id: "totals",
            title: t("rd.p.totals"),
            empty: "",
            rows: [
              { primary: t("rd.s.people", { count: health.people }), secondary: t("rd.s.enrolments", { count: health.enrolments }), href: "/platform" },
              { primary: t("rd.s.certificates", { count: health.certificates }), secondary: t("rd.p.acrossAll"), href: "/platform" },
            ],
          },
        ]
      : [],
  };
}
