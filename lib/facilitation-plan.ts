import { and, asc, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessments,
  attendanceRecords,
  cohortMembers,
  cohortSessions,
  cohorts,
  courses,
  curriculumModules,
  qualifications,
  sessionWorkbooks,
  studyUnitModules,
  studyUnits,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * A class session's facilitation plan (job sheet D20), laid out as Curiosa's
 * own is (the Facilitation Plans folder of their cohort file, 8 October 2026):
 * the programme, the date, the modules covered, the agenda, the apologies, the
 * learners in attendance, the resources, the next lecture and the
 * proceedings. Everything but the agenda, resources and proceedings is read
 * from the record, so the facilitator writes only what the platform cannot
 * know, and nothing is typed twice.
 */

export class FacilitationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacilitationPlanError";
  }
}

export type FacilitationPlan = {
  programme: string;
  saqaId: string | null;
  cohort: { id: string; name: string };
  session: { id: string; date: string; startTime: string | null; endTime: string | null; kind: string; title: string | null; sequence: number | null; venue: string | null; meetingUrl: string | null };
  facilitator: string | null;
  unit: { code: string; title: string } | null;
  modules: { code: string; title: string; component: string }[];
  workbooks: { title: string; role: string }[];
  present: string[];
  apologies: { name: string; note: string | null }[];
  absent: string[];
  unmarked: string[];
  next: { date: string; startTime: string | null; title: string | null; kind: string; sequence: number | null } | null;
  agenda: string | null;
  resources: string | null;
  proceedings: string | null;
};

export async function facilitationPlan(session: AuthenticatedSession, sessionId: string): Promise<FacilitationPlan> {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select().from(cohortSessions).where(eq(cohortSessions.id, sessionId));
    if (!row) throw new FacilitationPlanError("No such class session.");
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, row.cohortId));
    if (!cohort) throw new FacilitationPlanError("No such cohort.");

    const [programme] = cohort.qualificationId
      ? await tx.select({ title: qualifications.title, saqaId: qualifications.saqaId }).from(qualifications).where(eq(qualifications.id, cohort.qualificationId))
      : cohort.courseId
        ? await tx
            .select({ title: courses.title, saqaId: qualifications.saqaId })
            .from(courses)
            .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
            .leftJoin(qualifications, eq(qualifications.id, studyUnits.qualificationId))
            .where(eq(courses.id, cohort.courseId))
        : [];

    const [facilitator] = row.facilitatorId
      ? await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, row.facilitatorId))
      : cohort.facilitatorId
        ? await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, cohort.facilitatorId))
        : [];

    const [unit] = row.studyUnitId ? await tx.select({ code: studyUnits.code, title: studyUnits.title }).from(studyUnits).where(eq(studyUnits.id, row.studyUnitId)) : [];
    // The modules: the one the session names, else every module of its study unit.
    const modules = row.curriculumModuleId
      ? await tx.select({ code: curriculumModules.code, title: curriculumModules.title, component: curriculumModules.component }).from(curriculumModules).where(eq(curriculumModules.id, row.curriculumModuleId))
      : row.studyUnitId
        ? await tx
            .select({ code: curriculumModules.code, title: curriculumModules.title, component: curriculumModules.component })
            .from(studyUnitModules)
            .innerJoin(curriculumModules, eq(curriculumModules.id, studyUnitModules.curriculumModuleId))
            .where(eq(studyUnitModules.studyUnitId, row.studyUnitId))
            .orderBy(asc(curriculumModules.code))
        : [];

    const workbooks = await tx
      .select({ title: assessments.title, role: sessionWorkbooks.role })
      .from(sessionWorkbooks)
      .innerJoin(assessments, eq(assessments.id, sessionWorkbooks.assessmentId))
      .where(eq(sessionWorkbooks.sessionId, sessionId));

    const members = await tx
      .select({ userId: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(and(eq(cohortMembers.cohortId, row.cohortId), isNull(cohortMembers.leftAt)))
      .orderBy(asc(users.lastName), asc(users.firstName));
    const marks = members.length
      ? await tx
          .select({ userId: attendanceRecords.userId, status: attendanceRecords.status, note: attendanceRecords.note })
          .from(attendanceRecords)
          .where(and(eq(attendanceRecords.sessionId, sessionId), inArray(attendanceRecords.userId, members.map((member) => member.userId))))
      : [];
    const name = (member: { firstName: string; lastName: string }) => `${member.firstName} ${member.lastName}`;
    const markOf = (userId: string) => marks.find((mark) => mark.userId === userId);

    const [next] = await tx
      .select({ date: cohortSessions.scheduledDate, startTime: cohortSessions.startTime, title: cohortSessions.title, kind: cohortSessions.kind, sequence: cohortSessions.sequence })
      .from(cohortSessions)
      .where(and(eq(cohortSessions.cohortId, row.cohortId), gt(cohortSessions.scheduledDate, row.scheduledDate), notInArray(cohortSessions.status, ["cancelled", "postponed"])))
      .orderBy(asc(cohortSessions.scheduledDate), asc(cohortSessions.startTime))
      .limit(1);

    return {
      programme: programme?.title ?? cohort.name,
      saqaId: programme?.saqaId ?? null,
      cohort: { id: cohort.id, name: cohort.name },
      session: { id: row.id, date: row.scheduledDate, startTime: row.startTime, endTime: row.endTime, kind: row.kind, title: row.title, sequence: row.sequence, venue: row.venue, meetingUrl: row.meetingUrl },
      facilitator: facilitator ? name(facilitator) : null,
      unit: unit ?? null,
      modules,
      workbooks,
      present: members.filter((member) => markOf(member.userId)?.status === "present").map(name),
      apologies: members.filter((member) => markOf(member.userId)?.status === "excused").map((member) => ({ name: name(member), note: markOf(member.userId)?.note ?? null })),
      absent: members.filter((member) => markOf(member.userId)?.status === "absent").map(name),
      unmarked: members.filter((member) => !markOf(member.userId)).map(name),
      next: next ?? null,
      agenda: row.agenda,
      resources: row.resources,
      proceedings: row.proceedings,
    };
  });
}

const notesInput = z.object({
  sessionId: z.string().uuid(),
  agenda: z.string().trim().max(10000).optional(),
  resources: z.string().trim().max(10000).optional(),
  proceedings: z.string().trim().max(20000).optional(),
});

/** The facilitator's parts of the plan: agenda, resources and proceedings. */
export async function savePlanNotes(session: AuthenticatedSession, input: z.input<typeof notesInput>) {
  assertSessionCan(session, "attendance:record");
  const parsed = notesInput.parse(input);
  await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select({ id: cohortSessions.id, cohortId: cohortSessions.cohortId }).from(cohortSessions).where(eq(cohortSessions.id, parsed.sessionId));
    if (!row) throw new FacilitationPlanError("No such class session.");
    await tx
      .update(cohortSessions)
      .set({ agenda: parsed.agenda || null, resources: parsed.resources || null, proceedings: parsed.proceedings || null, updatedAt: new Date() })
      .where(eq(cohortSessions.id, parsed.sessionId));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "session.plan_written",
      entityType: "cohort_session",
      entityId: parsed.sessionId,
      after: { cohortId: row.cohortId },
    });
  });
}
