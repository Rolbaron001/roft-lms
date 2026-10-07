import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { assessments, cohortSessions, cohorts, courseSteps, courses, programmeDocuments, studyUnits } from "@/db/schema";
import { readXlsxSheets } from "./office";
import { cohortCourseIds } from "./schedule";
import { resolveTitles } from "./spine";
import { setSchedule } from "./cohorts";
import { scheduleSession } from "./scheduling";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Reading a cohort's roll-out schedule into its release dates (Roland, 7
 * October 2026: "Yes, read it in").
 *
 * A provider plans a cohort in a spreadsheet: a row per lecture date, and in
 * that row which study unit starts, which workbooks are handed out and which
 * are handed in, and when a summative is sat. That spreadsheet already says
 * everything the cohort's schedule needs, so it is read rather than retyped.
 *
 * Columns are found by their headings (date, hand-out, submission, feedback,
 * alignment, assessment), not by position, and workbooks by what they are
 * called ("SU1 WB2"), so another provider's roll-out of the same kind reads
 * the same way. Nothing is saved until the person has seen what was read.
 */

export type RolloutRow = {
  date: string;
  startTime: string | null;
  endTime: string | null;
  kind: "induction" | "lecture" | "summative" | "revision" | "mock_eisa";
  title: string;
};

export type ParsedRollout = {
  rows: RolloutRow[];
  /** "SU1 WB2" → the date it is handed out. */
  handouts: Map<string, string>;
  /** "SU1 WB2" → the date it is handed in. */
  submissions: Map<string, string>;
  /** Study unit number → the date it starts. */
  unitStarts: Map<number, string>;
  /** Study unit number → the summative's sitting, first and last day. */
  summatives: Map<number, { opens: string; due: string }>;
  /** What was in the sheet and has nowhere to go on the platform. */
  unused: string[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A cell as a date: Excel's serial number, or text written as a date. */
function asDate(cell: string): string | null {
  const text = cell.trim();
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** "2 Dec" in the year of `near`, or the next year where that would be earlier. */
function dayMonth(text: string, near: string): string | null {
  const match = /(\d{1,2})\s+([A-Za-z]{3})/.exec(text);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2].toLowerCase());
  if (month < 0) return null;
  let year = Number(near.slice(0, 4));
  const candidate = (y: number) => new Date(Date.UTC(y, month, Number(match[1]))).toISOString().slice(0, 10);
  if (candidate(year) < near.slice(0, 8) + "01") year += 1;
  return candidate(year);
}

const WORKBOOK = /\bSU\s*0*(\d+)\s*WB\s*0*(\d+)\b/gi;

/** Reads the first sheet that looks like a roll-out: a date column and hand-out or submission columns. */
export function readRollout(bytes: Uint8Array): ParsedRollout {
  const sheets = readXlsxSheets(bytes);
  for (const sheet of sheets) {
    const headerIndex = sheet.rows.slice(0, 25).findIndex((row) => row.some((cell) => /^dates?$/i.test(cell.trim())) && row.some((cell) => /hand\s*-?\s*out|submi/i.test(cell)));
    if (headerIndex < 0) continue;
    const header = sheet.rows[headerIndex].map((cell) => cell.replace(/\s+/g, " ").trim());
    const column = (pattern: RegExp, not?: RegExp) => header.findIndex((cell) => pattern.test(cell) && !(not && not.test(cell)));
    const columns = {
      date: column(/^dates?$/i),
      time: column(/lecture/i, /#/),
      number: column(/#|^no\.?$/i),
      alignment: column(/alignment|curriculum|module/i),
      handout: column(/hand\s*-?\s*out|issued?/i),
      submission: column(/submi|hand\s*-?\s*in/i),
      feedback: column(/feedback|return/i),
      assessment: column(/moderation|assessment/i),
    };
    const result: ParsedRollout = { rows: [], handouts: new Map(), submissions: new Map(), unitStarts: new Map(), summatives: new Map(), unused: [] };
    const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");

    for (const row of sheet.rows.slice(headerIndex + 1)) {
      const date = asDate(cell(row, columns.date));
      if (!date) continue;
      const alignment = cell(row, columns.alignment);
      const time = /(\d{1,2}:\d{2})\s*(?:to|-|–)\s*(\d{1,2}:\d{2})/.exec(cell(row, columns.time));
      const pad = (clock: string) => clock.padStart(5, "0");

      const unit = /study\s*unit\s*0*(\d+)/i.exec(alignment);
      const summative = /SU\s*0*(\d+)\b.*summative/i.exec(alignment);
      if (unit && !summative && !result.unitStarts.has(Number(unit[1]))) result.unitStarts.set(Number(unit[1]), date);

      for (const match of cell(row, columns.handout).matchAll(WORKBOOK)) result.handouts.set(`SU${match[1]} WB${match[2]}`, date);
      for (const match of cell(row, columns.submission).matchAll(WORKBOOK)) result.submissions.set(`SU${match[1]} WB${match[2]}`, date);
      const feedback = cell(row, columns.feedback);
      if (feedback) result.unused.push(`${date}: feedback on ${feedback.replace(/\s*\n\s*/g, ", ")}`);

      if (summative) {
        const sitting = /SA\s*0*(\d+)[^0-9]*?(\d{1,2}\s+[A-Za-z]{3})\s*(?:-|–|to)\s*(\d{1,2}\s+[A-Za-z]{3})/i.exec(cell(row, columns.assessment));
        const opens = sitting ? dayMonth(sitting[2], date) : date;
        const due = sitting ? dayMonth(sitting[3], date) : date;
        result.summatives.set(Number(summative[1]), { opens: opens ?? date, due: due ?? date });
      }

      const firstLine = alignment.split("\n")[0].trim();
      result.rows.push({
        date,
        startTime: time ? pad(time[1]) : null,
        endTime: time ? pad(time[2]) : null,
        kind: /induction/i.test(alignment) ? "induction" : summative ? "summative" : /mock\s*eisa/i.test(alignment) ? "mock_eisa" : /prep|revision/i.test(alignment) ? "revision" : "lecture",
        title: firstLine || (cell(row, columns.number) ? `Lecture ${cell(row, columns.number)}` : "Lecture"),
      });
    }
    return result;
  }
  throw new Error("No roll-out schedule was found: no sheet has a Dates column with hand-out or submission columns beside it.");
}

export type RolloutPlan = {
  entries: { stepId: string; title: string; opens: string | null; due: string | null }[];
  sessions: RolloutRow[];
  /** Named in the roll-out with no step on the platform to match. */
  unmatched: string[];
  unused: string[];
  /** Steps the roll-out does not date; they wait for a hand release. */
  undated: string[];
};

/** What the roll-out would set on this cohort, matched to its steps. Saves nothing. */
export async function planRollout(session: AuthenticatedSession, cohortId: string, parsed: ParsedRollout): Promise<RolloutPlan> {
  assertSessionCan(session, "enrolment:manage");
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new Error("No such cohort.");
    const courseIds = await cohortCourseIds(tx, cohort);
    const unitOf = new Map(
      (courseIds.length
        ? await tx.select({ courseId: courses.id, code: studyUnits.code }).from(courses).innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId)).where(inArray(courses.id, courseIds))
        : []
      ).map((row) => [row.courseId, Number(/\d+/.exec(row.code)?.[0] ?? 0)]),
    );
    const steps = courseIds.length ? await tx.select().from(courseSteps).where(inArray(courseSteps.courseId, courseIds)).orderBy(asc(courseSteps.sortOrder)) : [];
    const titles = await resolveTitles(tx, steps);
    const assessmentIds = steps.map((step) => step.assessmentId).filter((id): id is string => Boolean(id));
    const purposes = new Map((assessmentIds.length ? await tx.select({ id: assessments.id, purpose: assessments.purpose }).from(assessments).where(inArray(assessments.id, assessmentIds)) : []).map((row) => [row.id, row.purpose]));
    const documentIds = steps.map((step) => step.programmeDocumentId).filter((id): id is string => Boolean(id));
    const documentKinds = new Map((documentIds.length ? await tx.select({ id: programmeDocuments.id, kind: programmeDocuments.kind }).from(programmeDocuments).where(inArray(programmeDocuments.id, documentIds)) : []).map((row) => [row.id, row.kind]));

    const entries: RolloutPlan["entries"] = [];
    const undated: string[] = [];
    const used = new Set<string>();
    for (const step of steps) {
      const unit = unitOf.get(step.courseId) ?? 0;
      const title = titles.get(step.id) ?? "Step";
      let opens: string | null = null;
      let due: string | null = null;
      if (step.kind === "assessment" && purposes.get(step.assessmentId!) === "summative") {
        // A second version is the re-sit paper, released by hand when needed.
        if (!/\bV\s*[2-9]\b/i.test(title)) {
          opens = parsed.summatives.get(unit)?.opens ?? null;
          due = parsed.summatives.get(unit)?.due ?? null;
          if (opens) used.add(`SU${unit} summative`);
        }
      } else if (step.kind === "assessment") {
        const number = /\bWB\s*0*(\d+)\b/i.exec(title)?.[1];
        const key = number ? `SU${unit} WB${number}` : null;
        if (key) {
          opens = parsed.handouts.get(key) ?? null;
          due = parsed.submissions.get(key) ?? null;
          if (opens || due) used.add(key);
        }
      } else if (step.kind === "workplace" || (step.kind === "document" && documentKinds.get(step.programmeDocumentId!) !== undefined)) {
        opens = parsed.unitStarts.get(unit) ?? null;
      }
      if (opens || due) entries.push({ stepId: step.id, title, opens, due });
      else undated.push(title);
    }

    const named = [...parsed.handouts.keys(), ...parsed.submissions.keys()];
    const unmatched = [...new Set(named.filter((key) => !used.has(key)))];
    for (const unit of parsed.summatives.keys()) if (!used.has(`SU${unit} summative`)) unmatched.push(`SU${unit} summative`);
    return { entries, sessions: parsed.rows, unmatched, unused: parsed.unused, undated };
  });
}

/**
 * Saves the plan: the cohort's schedule, as days from its start, and a class
 * session for every dated row the cohort does not already have one on. The
 * schedule replaces the cohort's old one; hand releases are kept
 * (lib/cohorts.ts).
 */
export async function applyRollout(session: AuthenticatedSession, cohortId: string, plan: RolloutPlan): Promise<{ scheduled: number; sessions: number }> {
  assertSessionCan(session, "enrolment:manage");
  const { startDate, existingDates } = await withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select({ startDate: cohorts.startDate }).from(cohorts).where(eq(cohorts.id, cohortId));
    const held = await tx.select({ date: cohortSessions.scheduledDate }).from(cohortSessions).where(and(eq(cohortSessions.cohortId, cohortId)));
    return { startDate: cohort.startDate, existingDates: new Set(held.map((row) => row.date)) };
  });
  const days = (date: string | null) => (date ? Math.max(0, Math.round((Date.parse(date) - Date.parse(startDate)) / 86_400_000)) : null);
  await setSchedule(
    session,
    cohortId,
    plan.entries.map((entry) => {
      const opensAfterDays = days(entry.opens);
      const dueAfterDays = days(entry.due);
      return { stepId: entry.stepId, opensAfterDays, dueAfterDays: dueAfterDays !== null && opensAfterDays !== null && dueAfterDays < opensAfterDays ? opensAfterDays : dueAfterDays };
    }),
  );
  let sessions = 0;
  if (session.permissions.includes("session:manage")) {
    for (const row of plan.sessions) {
      if (existingDates.has(row.date)) continue;
      await scheduleSession(session, {
        cohortId,
        kind: row.kind,
        title: row.title,
        scheduledDate: row.date,
        startTime: row.startTime ?? undefined,
        endTime: row.endTime ?? undefined,
        deliveryMode: "virtual",
      });
      sessions += 1;
    }
  }
  return { scheduled: plan.entries.length, sessions };
}
