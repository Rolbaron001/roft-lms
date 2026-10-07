import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { assessments, cohortSessions, cohorts, courseSteps, courses, programmeDocuments, stepReleases, studyUnits } from "@/db/schema";
import { recordAudit } from "./audit";
import { cohortCourseIds, dayFrom } from "./schedule";
import { resolveTitles } from "./spine";
import { CohortError, setSchedule } from "./cohorts";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Planning a cohort inside the platform (Roland, 7 October 2026): "all the
 * management work should be conducted within the LMS", in a place where "the
 * outcome of input is immediately visible on the screen that a user is
 * working on". The cohort's plan read whole, a first plan drafted from the
 * qualification itself, and one item's dates changed without touching the
 * rest. The screen is app/cohorts/[id]/plan.
 */

export type PlanStep = {
  id: string;
  unitCode: string;
  unitTitle: string;
  /** "Workbook 3", "Theory guide", "Summative SA1", "Workplace module 1". */
  label: string;
  title: string;
  category: "theory_guide" | "material" | "workbook" | "summative" | "workplace" | "lesson";
  /** A second version of a summative: the re-sit paper. */
  resit: boolean;
  opens: string | null;
  due: string | null;
  releasedAt: string | null;
};

export type CohortPlan = {
  cohort: { id: string; name: string; startDate: string; releaseMode: string; qualificationId: string | null; courseId: string | null };
  units: { code: string; title: string }[];
  steps: PlanStep[];
  sessions: { date: string; title: string | null; startTime: string | null; kind: string }[];
};

const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(Date.parse(date) + days * 86_400_000));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export async function cohortPlan(session: AuthenticatedSession, cohortId: string): Promise<CohortPlan> {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortError("No such cohort.", "not_found");
    const courseIds = await cohortCourseIds(tx, cohort);
    const unitRows = courseIds.length
      ? await tx
          .select({ courseId: courses.id, code: studyUnits.code, title: studyUnits.title, courseTitle: courses.title })
          .from(courses)
          .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
          .where(inArray(courses.id, courseIds))
      : [];
    const unitOf = new Map(unitRows.map((row) => [row.courseId, { code: row.code ?? "", title: row.title ?? row.courseTitle }]));
    const steps = (courseIds.length ? await tx.select().from(courseSteps).where(inArray(courseSteps.courseId, courseIds)) : []).sort(
      (a, b) => courseIds.indexOf(a.courseId) - courseIds.indexOf(b.courseId) || a.sortOrder - b.sortOrder,
    );
    const titles = await resolveTitles(tx, steps);
    const assessmentIds = steps.map((step) => step.assessmentId).filter((id): id is string => Boolean(id));
    const purposes = new Map((assessmentIds.length ? await tx.select({ id: assessments.id, purpose: assessments.purpose }).from(assessments).where(inArray(assessments.id, assessmentIds)) : []).map((row) => [row.id, row.purpose]));
    const documentIds = steps.map((step) => step.programmeDocumentId).filter((id): id is string => Boolean(id));
    const documentKinds = new Map((documentIds.length ? await tx.select({ id: programmeDocuments.id, kind: programmeDocuments.kind }).from(programmeDocuments).where(inArray(programmeDocuments.id, documentIds)) : []).map((row) => [row.id, row.kind]));
    const releases = new Map((await tx.select().from(stepReleases).where(eq(stepReleases.cohortId, cohortId))).map((row) => [row.stepId, row]));
    const sessions = await tx
      .select({ date: cohortSessions.scheduledDate, title: cohortSessions.title, startTime: cohortSessions.startTime, kind: cohortSessions.kind })
      .from(cohortSessions)
      .where(eq(cohortSessions.cohortId, cohortId))
      .orderBy(asc(cohortSessions.scheduledDate));

    const planSteps: PlanStep[] = steps.map((step) => {
      const unit = unitOf.get(step.courseId) ?? { code: "", title: "" };
      const title = titles.get(step.id) ?? "Step";
      const category: PlanStep["category"] =
        step.kind === "assessment"
          ? purposes.get(step.assessmentId!) === "summative"
            ? "summative"
            : "workbook"
          : step.kind === "document"
            ? documentKinds.get(step.programmeDocumentId!) === "theory_guide"
              ? "theory_guide"
              : "material"
            : step.kind === "workplace"
              ? "workplace"
              : "lesson";
      const workbook = /\bWB\s*0*(\d+)\b/i.exec(title)?.[1];
      const summative = /\bSA\s*0*(\d+)\b/i.exec(title)?.[1];
      const workplace = /module\s*(\d+)/i.exec(title)?.[1];
      const label =
        category === "workbook" && workbook
          ? `Workbook ${workbook}`
          : category === "summative"
            ? `Summative${summative ? ` SA${summative}` : ""}`
            : category === "theory_guide"
              ? "Theory guide"
              : category === "workplace" && workplace
                ? `Workplace module ${workplace}`
                : title;
      const release = releases.get(step.id);
      return {
        id: step.id,
        unitCode: unit.code,
        unitTitle: unit.title,
        label,
        title,
        category,
        resit: category === "summative" && /\bV\s*[2-9]\b/i.test(title),
        // A row with no opening day opens at once, unless it is only there to
        // hold a hand release, which is shown as the release instead.
        opens: release
          ? release.opensAfterDays !== null
            ? iso(dayFrom(cohort.startDate, release.opensAfterDays))
            : release.releasedAt
              ? null
              : cohort.startDate
          : null,
        due: release?.dueAfterDays != null ? iso(dayFrom(cohort.startDate, release.dueAfterDays)) : null,
        releasedAt: release?.releasedAt ? iso(release.releasedAt) : null,
      };
    });

    const units: CohortPlan["units"] = [];
    for (const step of planSteps) if (!units.some((unit) => unit.code === step.unitCode)) units.push({ code: step.unitCode, title: step.unitTitle });

    return {
      cohort: { id: cohort.id, name: cohort.name, startDate: cohort.startDate, releaseMode: cohort.releaseMode, qualificationId: cohort.qualificationId, courseId: cohort.courseId },
      units,
      steps: planSteps,
      sessions: sessions.map((row) => ({ date: row.date, title: row.title, startTime: row.startTime, kind: row.kind })),
    };
  });
}

/**
 * A first plan, drafted from the qualification itself. Each study unit starts
 * on a lecture day; its theory guide, material and workplace module open
 * then; one workbook a week is handed out and handed in the week after; the
 * summative is sat the week after the last workbook is in; the next study unit
 * starts the week after that. Lecture days are the cohort's class sessions
 * where it has them, otherwise the same weekday as its start. A re-sit paper
 * is left to be released by hand. Replaces the plan; hand releases are kept.
 */
export async function autoPlan(session: AuthenticatedSession, cohortId: string): Promise<number> {
  assertSessionCan(session, "enrolment:manage");
  const plan = await cohortPlan(session, cohortId);
  const lectureDays = plan.sessions.filter((row) => row.kind === "lecture" || row.kind === "summative").map((row) => row.date);
  // The next lecture day on or after a date, or the date itself.
  const lectureOnOrAfter = (date: string) => lectureDays.find((day) => day >= date) ?? date;

  const entries: { stepId: string; opensAfterDays: number | null; dueAfterDays: number | null }[] = [];
  const offset = (date: string) => Math.max(0, daysBetween(plan.cohort.startDate, date));
  let cursor = lectureOnOrAfter(addDays(plan.cohort.startDate, lectureDays.length ? 0 : 7));

  for (const unit of plan.units) {
    const steps = plan.steps.filter((step) => step.unitCode === unit.code);
    const start = lectureOnOrAfter(cursor);
    for (const step of steps.filter((one) => one.category === "theory_guide" || one.category === "material" || one.category === "workplace" || one.category === "lesson")) {
      entries.push({ stepId: step.id, opensAfterDays: offset(start), dueAfterDays: null });
    }
    let week = start;
    let lastDue = start;
    for (const step of steps.filter((one) => one.category === "workbook")) {
      const opens = lectureOnOrAfter(week);
      const due = lectureOnOrAfter(addDays(opens, 7));
      entries.push({ stepId: step.id, opensAfterDays: offset(opens), dueAfterDays: offset(due) });
      week = addDays(opens, 7);
      lastDue = due;
    }
    const sitting = lectureOnOrAfter(addDays(lastDue, 7));
    for (const step of steps.filter((one) => one.category === "summative" && !one.resit)) {
      entries.push({ stepId: step.id, opensAfterDays: offset(sitting), dueAfterDays: offset(addDays(sitting, 2)) });
    }
    cursor = addDays(sitting, 7);
  }

  await setSchedule(session, cohortId, entries);
  return entries.length;
}

/** One item's dates, leaving the rest of the plan as it is. */
export async function setStepDates(
  session: AuthenticatedSession,
  cohortId: string,
  stepId: string,
  dates: { opens: string | null; due: string | null },
): Promise<void> {
  assertSessionCan(session, "enrolment:manage");
  for (const date of [dates.opens, dates.due]) {
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CohortError("Give dates as YYYY-MM-DD.", "invalid");
  }
  if (dates.opens && dates.due && dates.due < dates.opens) throw new CohortError("It cannot be due before it opens.", "invalid");
  await withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortError("No such cohort.", "not_found");
    const courseIds = await cohortCourseIds(tx, cohort);
    const [step] = courseIds.length ? await tx.select({ id: courseSteps.id }).from(courseSteps).where(and(eq(courseSteps.id, stepId), inArray(courseSteps.courseId, courseIds))) : [];
    if (!step) throw new CohortError("That step is not on this cohort's course.", "invalid");
    const days = (date: string | null) => (date ? Math.max(0, daysBetween(cohort.startDate, date)) : null);
    const [existing] = await tx.select().from(stepReleases).where(and(eq(stepReleases.cohortId, cohortId), eq(stepReleases.stepId, stepId)));
    if (!dates.opens && !dates.due && !existing?.releasedAt) {
      // Undated and not released by hand: it waits again.
      if (existing) await tx.delete(stepReleases).where(eq(stepReleases.id, existing.id));
    } else if (existing) {
      await tx.update(stepReleases).set({ opensAfterDays: days(dates.opens), dueAfterDays: days(dates.due) }).where(eq(stepReleases.id, existing.id));
    } else {
      await tx.insert(stepReleases).values({ organisationId: session.organisationId, cohortId, stepId, opensAfterDays: days(dates.opens), dueAfterDays: days(dates.due) });
    }
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.step_dated",
      entityType: "cohort",
      entityId: cohortId,
      after: { stepId, ...dates },
    });
  });
}
