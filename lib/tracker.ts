import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  attendanceRecords,
  cohortMembers,
  cohortSessions,
  cohortTasks,
  cohorts,
  courses,
  curriculumModules,
  qualifications,
  studyUnits,
  sessionWorkbooks,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The tracker: what the client keeps on spreadsheets.
 *
 * Two of them, and this file replaces both. A project tracker across every
 * active programme, and a consolidated workbook per cohort holding a grid of
 * every learner against every piece of assessed work.
 *
 * Replacing them was agreed on 27 August 2026, and the reason is not tidiness.
 * A spreadsheet is a copy of what the platform already knows, maintained by
 * hand, which means it is wrong between the moment something happens and the
 * moment somebody remembers to type it in - and nobody can tell which state it
 * is in by looking. Everything here is derived from the records themselves.
 *
 * Nothing in this file stores a status that could be computed. The client's
 * grid statuses are read from submissions, decisions and registers rather than
 * kept alongside them, because two places to say the same thing is two places
 * to disagree.
 */

/**
 * The qualifications table joined a second time, for the study-unit route.
 * Postgres needs the two joins distinguished, and an alias is how.
 */
const unitQualification = alias(qualifications, "unit_qualification");

export class TrackerError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid_state",
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

// ---------------------------------------------------------------------------
// Across every programme
// ---------------------------------------------------------------------------

export type ActiveProgramme = {
  cohortId: string;
  cohortName: string;
  courseTitle: string;
  qualificationTitle: string | null;
  learners: number;
  startDate: string;
  endDate: string | null;
  eisaRegistrationDate: string | null;
  eisaDate: string | null;
  eisaNote: string | null;
  monitoringVisitStatus: string;
  monitoringVisitDate: string | null;
  status: string;
  /** Of the sessions that count, how many have been held. */
  sessionsHeld: number;
  sessionsTotal: number;
  /** Tasks complete against tasks that count, as a percentage. */
  tasksPercent: number | null;
};

/**
 * Every cohort, with the dates a coordinator plans around.
 *
 * This is the client's "Active Programmes" sheet. It answers one question -
 * what is running and what is coming - so it carries the training dates, the
 * external assessment dates, and whether the quality council has been.
 */
export async function activeProgrammes(
  session: AuthenticatedSession,
  options: { includeFinished?: boolean } = {},
): Promise<ActiveProgramme[]> {
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        cohortId: cohorts.id,
        cohortName: cohorts.name,
        courseTitle: courses.title,
        // A course reaches its qualification through the curriculum module it
        // teaches, or through the study unit it belongs to. Either can be the
        // link and neither is guaranteed, so both are followed and the first
        // answer wins.
        qualificationTitle: sql<
          string | null
        >`coalesce(${qualifications.title}, ${unitQualification.title})`,
        startDate: cohorts.startDate,
        endDate: cohorts.endDate,
        eisaRegistrationDate: cohorts.eisaRegistrationDate,
        eisaDate: cohorts.eisaDate,
        eisaNote: cohorts.eisaNote,
        monitoringVisitStatus: cohorts.monitoringVisitStatus,
        monitoringVisitDate: cohorts.monitoringVisitDate,
        status: cohorts.status,
      })
      .from(cohorts)
      .innerJoin(courses, eq(courses.id, cohorts.courseId))
      .leftJoin(
        curriculumModules,
        eq(curriculumModules.id, courses.curriculumModuleId),
      )
      .leftJoin(
        qualifications,
        eq(qualifications.id, curriculumModules.qualificationId),
      )
      .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .leftJoin(
        unitQualification,
        eq(unitQualification.id, studyUnits.qualificationId),
      )
      .orderBy(asc(cohorts.startDate));

    const wanted = options.includeFinished
      ? rows
      : rows.filter((row) => row.status !== "finished" && row.status !== "cancelled");

    if (wanted.length === 0) return [];

    const ids = wanted.map((row) => row.cohortId);

    const counts = await tx
      .select({
        cohortId: cohortMembers.cohortId,
        learners: sql<number>`count(*)::int`,
      })
      .from(cohortMembers)
      .where(
        and(inArray(cohortMembers.cohortId, ids), isNull(cohortMembers.leftAt)),
      )
      .groupBy(cohortMembers.cohortId);

    // Sessions that count towards progress: not cancelled, not voluntary. The
    // same exclusions the attendance figures use, for the same reasons.
    const sessions = await tx
      .select({
        cohortId: cohortSessions.cohortId,
        status: cohortSessions.status,
        scheduledDate: cohortSessions.scheduledDate,
        kind: cohortSessions.kind,
      })
      .from(cohortSessions)
      .where(inArray(cohortSessions.cohortId, ids));

    const tasks = await tx
      .select({
        cohortId: cohortTasks.cohortId,
        status: cohortTasks.status,
      })
      .from(cohortTasks)
      .where(inArray(cohortTasks.cohortId, ids));

    const today = new Date().toISOString().slice(0, 10);

    return wanted.map((row) => {
      const mine = sessions.filter(
        (s) =>
          s.cohortId === row.cohortId &&
          s.kind !== "walk_in" &&
          s.status !== "cancelled" &&
          s.status !== "postponed",
      );

      const myTasks = tasks.filter(
        (t) => t.cohortId === row.cohortId && t.status !== "cancelled",
      );
      const done = myTasks.filter((t) => t.status === "complete").length;

      return {
        ...row,
        learners:
          counts.find((c) => c.cohortId === row.cohortId)?.learners ?? 0,
        sessionsTotal: mine.length,
        sessionsHeld: mine.filter(
          (s) => s.status === "completed" || s.scheduledDate <= today,
        ).length,
        tasksPercent:
          myTasks.length === 0
            ? null
            : Math.round((done / myTasks.length) * 100),
      };
    });
  });
}

// ---------------------------------------------------------------------------
// One cohort, learner by learner
// ---------------------------------------------------------------------------

/**
 * What a learner's position on one piece of work is, in the client's own
 * words.
 *
 * Derived rather than stored. Every one of these is already recorded
 * somewhere - a submission, a decision, a register - and writing it down a
 * second time would create a second version of the truth that drifts from the
 * first. The cost is a slightly heavier query; the benefit is that the grid
 * cannot be stale.
 */
export type GridStatus =
  | "not_started"
  | "draft"
  | "submitted"
  | "competent"
  | "not_yet_competent"
  | "remediation"
  | "absent"
  | "left";

export type GridCell = {
  assessmentId: string;
  status: GridStatus;
  /** The date the position was reached, where one is known. */
  on: string | null;
};

export type CohortGrid = {
  cohort: { id: string; name: string };
  /** Columns, in the order the cohort meets them. */
  assessments: {
    id: string;
    title: string;
    purpose: string;
    /** The dated session this is handed in at, where the schedule says. */
    dueOn: string | null;
  }[];
  learners: {
    userId: string;
    name: string;
    /** Null where the learner has left, so the row reads as closed. */
    leftAt: string | null;
    cells: GridCell[];
  }[];
};

/**
 * The consolidated assessment grid: every learner against every piece of work.
 *
 * The client's "Ass Overall" sheet, which is the densest thing they keep and
 * the one a monitoring visit asks to see. Columns are ordered by when the work
 * is collected rather than alphabetically, because the question being asked of
 * it is almost always "where has this cohort got to".
 */
export async function cohortGrid(
  session: AuthenticatedSession,
  cohortId: string,
): Promise<CohortGrid> {
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx
      .select({ id: cohorts.id, name: cohorts.name, courseId: cohorts.courseId })
      .from(cohorts)
      .where(eq(cohorts.id, cohortId));

    if (!cohort) throw new TrackerError("Cohort not found.", "not_found");

    const learners = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        leftAt: cohortMembers.leftAt,
      })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(eq(cohortMembers.cohortId, cohortId))
      .orderBy(asc(users.lastName), asc(users.firstName));

    const columns = await tx
      .select({
        id: assessments.id,
        title: assessments.title,
        purpose: assessments.purpose,
      })
      .from(assessments)
      .where(eq(assessments.courseId, cohort.courseId))
      .orderBy(asc(assessments.title));

    if (columns.length === 0 || learners.length === 0) {
      return {
        cohort: { id: cohort.id, name: cohort.name },
        assessments: columns.map((column) => ({ ...column, dueOn: null })),
        learners: learners.map((learner) => ({
          userId: learner.userId,
          name: `${learner.firstName} ${learner.lastName}`,
          leftAt: learner.leftAt ? learner.leftAt.toISOString() : null,
          cells: [],
        })),
      };
    }

    const assessmentIds = columns.map((column) => column.id);
    const learnerIds = learners.map((learner) => learner.userId);

    // When each piece of work is collected, from the roll-out schedule. This
    // is what orders the columns: the client reads the grid left to right as
    // the programme runs.
    const collected = await tx
      .select({
        assessmentId: sessionWorkbooks.assessmentId,
        date: cohortSessions.scheduledDate,
      })
      .from(sessionWorkbooks)
      .innerJoin(
        cohortSessions,
        eq(cohortSessions.id, sessionWorkbooks.sessionId),
      )
      .where(
        and(
          eq(cohortSessions.cohortId, cohortId),
          inArray(sessionWorkbooks.assessmentId, assessmentIds),
          eq(sessionWorkbooks.role, "submission"),
        ),
      );

    const dueBy = new Map(collected.map((row) => [row.assessmentId, row.date]));

    const submissions = await tx
      .select({
        id: assessmentSubmissions.id,
        assessmentId: assessmentSubmissions.assessmentId,
        userId: assessmentSubmissions.userId,
        status: assessmentSubmissions.status,
        submittedAt: assessmentSubmissions.submittedAt,
      })
      .from(assessmentSubmissions)
      .where(
        and(
          inArray(assessmentSubmissions.assessmentId, assessmentIds),
          inArray(assessmentSubmissions.userId, learnerIds),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber));

    const decisions = submissions.length
      ? await tx
          .select({
            submissionId: assessmentDecisions.submissionId,
            outcome: assessmentDecisions.outcome,
            signedAt: assessmentDecisions.signedAt,
          })
          .from(assessmentDecisions)
          .where(
            inArray(
              assessmentDecisions.submissionId,
              submissions.map((row) => row.id),
            ),
          )
      : [];

    // Absence from the sitting a summative is written at. Read from the
    // register rather than stored on the submission, because a learner who did
    // not attend has no submission for anything to be stored on - which is
    // exactly why "absent, first attempt" needs to come from somewhere else.
    const absences = await tx
      .select({
        userId: attendanceRecords.userId,
        assessmentId: sessionWorkbooks.assessmentId,
        date: cohortSessions.scheduledDate,
      })
      .from(attendanceRecords)
      .innerJoin(
        cohortSessions,
        eq(cohortSessions.id, attendanceRecords.sessionId),
      )
      .innerJoin(
        sessionWorkbooks,
        eq(sessionWorkbooks.sessionId, cohortSessions.id),
      )
      .where(
        and(
          eq(cohortSessions.cohortId, cohortId),
          eq(attendanceRecords.status, "absent"),
          inArray(sessionWorkbooks.assessmentId, assessmentIds),
        ),
      );

    const ordered = [...columns].sort((a, b) => {
      const left = dueBy.get(a.id);
      const right = dueBy.get(b.id);
      if (left && right) return left.localeCompare(right);
      // Anything with no place in the schedule sorts after everything that has
      // one, rather than interleaving unpredictably.
      if (left) return -1;
      if (right) return 1;
      return a.title.localeCompare(b.title);
    });

    return {
      cohort: { id: cohort.id, name: cohort.name },
      assessments: ordered.map((column) => ({
        ...column,
        dueOn: dueBy.get(column.id) ?? null,
      })),
      learners: learners.map((learner) => ({
        userId: learner.userId,
        name: `${learner.firstName} ${learner.lastName}`,
        leftAt: learner.leftAt ? learner.leftAt.toISOString() : null,
        cells: ordered.map((column) => {
          if (learner.leftAt) {
            return {
              assessmentId: column.id,
              status: "left" as const,
              on: learner.leftAt.toISOString().slice(0, 10),
            };
          }

          // The newest attempt is the one the grid shows, which is why the
          // submissions are ordered by attempt descending above.
          const submission = submissions.find(
            (row) =>
              row.assessmentId === column.id && row.userId === learner.userId,
          );

          if (!submission) {
            const absent = absences.find(
              (row) =>
                row.assessmentId === column.id &&
                row.userId === learner.userId,
            );
            if (absent) {
              return {
                assessmentId: column.id,
                status: "absent" as const,
                on: absent.date,
              };
            }
            return { assessmentId: column.id, status: "not_started" as const, on: null };
          }

          const decision = decisions.find(
            (row) => row.submissionId === submission.id,
          );

          if (decision) {
            return {
              assessmentId: column.id,
              status:
                decision.outcome === "competent"
                  ? ("competent" as const)
                  : ("not_yet_competent" as const),
              on: decision.signedAt
                ? decision.signedAt.toISOString().slice(0, 10)
                : null,
            };
          }

          const status: GridStatus =
            submission.status === "draft"
              ? "draft"
              : submission.status === "referred_back"
                ? "remediation"
                : "submitted";

          return {
            assessmentId: column.id,
            status,
            on: submission.submittedAt
              ? submission.submittedAt.toISOString().slice(0, 10)
              : null,
          };
        }),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// The work of running a cohort
// ---------------------------------------------------------------------------

export const taskInput = z.object({
  cohortId: z.string().uuid(),
  name: z.string().trim().min(2).max(300),
  description: z.string().trim().max(2000).optional(),
  assigneeId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function addCohortTask(
  session: AuthenticatedSession,
  input: z.input<typeof taskInput>,
) {
  assertSessionCan(session, "session:manage");
  const parsed = taskInput.parse(input);

  if (
    parsed.startDate &&
    parsed.dueDate &&
    parsed.dueDate < parsed.startDate
  ) {
    throw new TrackerError(
      `That task is due on ${parsed.dueDate}, before it starts on ${parsed.startDate}.`,
      "invalid_state",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(eq(cohorts.id, parsed.cohortId));
    if (!cohort) throw new TrackerError("Cohort not found.", "not_found");

    const [created] = await tx
      .insert(cohortTasks)
      .values({
        organisationId: session.organisationId,
        cohortId: parsed.cohortId,
        name: parsed.name,
        description: parsed.description ?? null,
        assigneeId: parsed.assigneeId ?? null,
        startDate: parsed.startDate ?? null,
        dueDate: parsed.dueDate ?? null,
      })
      .returning();

    return created;
  });
}

export async function setTaskStatus(
  session: AuthenticatedSession,
  taskId: string,
  status: "not_yet_started" | "in_progress" | "complete" | "cancelled" | "postponed",
) {
  assertSessionCan(session, "session:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [task] = await tx
      .select({ id: cohortTasks.id, status: cohortTasks.status })
      .from(cohortTasks)
      .where(eq(cohortTasks.id, taskId));

    if (!task) throw new TrackerError("Task not found.", "not_found");

    await tx
      .update(cohortTasks)
      .set({
        status,
        // Recorded when it is reached, and cleared if it is reopened, so the
        // date always means what it says.
        completedAt: status === "complete" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(cohortTasks.id, taskId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "cohort_task.status_changed",
      entityType: "cohort_task",
      entityId: taskId,
      before: { status: task.status },
      after: { status },
    });
  });
}

export async function cohortTaskList(
  session: AuthenticatedSession,
  cohortId: string,
) {
  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: cohortTasks.id,
        name: cohortTasks.name,
        description: cohortTasks.description,
        status: cohortTasks.status,
        startDate: cohortTasks.startDate,
        dueDate: cohortTasks.dueDate,
        assigneeFirst: users.firstName,
        assigneeLast: users.lastName,
      })
      .from(cohortTasks)
      .leftJoin(users, eq(users.id, cohortTasks.assigneeId))
      .where(eq(cohortTasks.cohortId, cohortId))
      .orderBy(asc(cohortTasks.sortOrder), asc(cohortTasks.createdAt)),
  );
}

/**
 * How far through the work of a cohort is.
 *
 * Cancelled tasks are left out of both halves rather than counted as done. A
 * cancelled task was not achieved, and counting it as complete would let a
 * cohort reach a hundred per cent by abandoning everything outstanding.
 */
export function taskProgress(
  tasks: { status: string }[],
): { complete: number; counted: number; percent: number | null } {
  const counted = tasks.filter((task) => task.status !== "cancelled");
  const complete = counted.filter((task) => task.status === "complete");

  return {
    complete: complete.length,
    counted: counted.length,
    percent:
      counted.length === 0
        ? null
        : Math.round((complete.length / counted.length) * 100),
  };
}
