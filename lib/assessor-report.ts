import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  cohortMembers,
  cohorts,
  courseSteps,
  courses,
  curriculumModules,
  formativeFeedback,
  qualifications,
  studyUnitModules,
  studyUnits,
  users,
} from "@/db/schema";
import { cohortCourseIds } from "./schedule";
import { cohortAttendance } from "./scheduling";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The assessor report for one study unit of a cohort (job sheet D20),
 * produced from the record rather than typed. Laid out as Curiosa's own
 * report is ("HRM Admin Assessor Report SU1", 8 October 2026): the programme,
 * its SAQA ID, level and credits, the study unit and cohort, the modules, the
 * assessment and the assessor; then each learner's formative work, first and
 * second summative results, attendance, and the assessor's comments.
 */

export class AssessorReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessorReportError";
  }
}

export type AssessorReport = {
  programme: string;
  saqaId: string | null;
  nqfLevel: number | null;
  credits: number | null;
  unit: { code: string; title: string };
  cohort: string;
  modules: string[];
  assessment: { title: string; date: string | null } | null;
  assessors: { name: string; email: string }[];
  learners: {
    userId: string;
    name: string;
    nationalId: string | null;
    formative: { returned: number; total: number };
    first: string | null;
    second: string | null;
    overallPercent: number | null;
    toDatePercent: number | null;
    comments: string[];
  }[];
};

export async function assessorReport(session: AuthenticatedSession, cohortId: string, studyUnitId: string): Promise<AssessorReport> {
  assertSessionCan(session, "enrolment:read_all");
  const attendance = await cohortAttendance(session, cohortId);

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new AssessorReportError("No such cohort.");
    const courseIds = await cohortCourseIds(tx, cohort);
    const [unit] = await tx.select().from(studyUnits).where(eq(studyUnits.id, studyUnitId));
    const unitCourses = courseIds.length
      ? await tx.select({ id: courses.id }).from(courses).where(and(inArray(courses.id, courseIds), eq(courses.studyUnitId, studyUnitId)))
      : [];
    if (!unit || unitCourses.length === 0) throw new AssessorReportError("That study unit is not on this cohort.");
    const [qualification] = await tx.select().from(qualifications).where(eq(qualifications.id, unit.qualificationId));

    const modules = await tx
      .select({ code: curriculumModules.code })
      .from(studyUnitModules)
      .innerJoin(curriculumModules, eq(curriculumModules.id, studyUnitModules.curriculumModuleId))
      .where(eq(studyUnitModules.studyUnitId, studyUnitId))
      .orderBy(asc(curriculumModules.code));

    const steps = await tx
      .select({ assessmentId: assessments.id, title: assessments.title, purpose: assessments.purpose })
      .from(courseSteps)
      .innerJoin(assessments, eq(assessments.id, courseSteps.assessmentId))
      .where(inArray(courseSteps.courseId, unitCourses.map((row) => row.id)))
      .orderBy(asc(courseSteps.sortOrder));
    const workbookIds = steps.filter((step) => step.purpose !== "summative").map((step) => step.assessmentId);
    const summativeIds = steps.filter((step) => step.purpose === "summative").map((step) => step.assessmentId);

    const members = await tx
      .select({ userId: users.id, firstName: users.firstName, lastName: users.lastName, nationalId: users.nationalId })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)))
      .orderBy(asc(users.lastName));
    const memberIds = members.map((member) => member.userId);

    const submissions = memberIds.length && steps.length
      ? await tx
          .select({ id: assessmentSubmissions.id, userId: assessmentSubmissions.userId, assessmentId: assessmentSubmissions.assessmentId, attempt: assessmentSubmissions.attemptNumber })
          .from(assessmentSubmissions)
          .where(and(inArray(assessmentSubmissions.userId, memberIds), inArray(assessmentSubmissions.assessmentId, steps.map((step) => step.assessmentId))))
      : [];
    const submissionIds = submissions.map((row) => row.id);
    const decisions = submissionIds.length
      ? await tx
          .select({
            submissionId: assessmentDecisions.submissionId,
            outcome: assessmentDecisions.outcome,
            comments: assessmentDecisions.comments,
            signedAt: assessmentDecisions.signedAt,
            assessorName: users.firstName,
            assessorSurname: users.lastName,
            assessorEmail: users.email,
          })
          .from(assessmentDecisions)
          .innerJoin(users, eq(users.id, assessmentDecisions.assessorId))
          .where(inArray(assessmentDecisions.submissionId, submissionIds))
          .orderBy(desc(assessmentDecisions.signedAt))
      : [];
    const feedback = submissionIds.length
      ? await tx.select({ submissionId: formativeFeedback.submissionId }).from(formativeFeedback).where(inArray(formativeFeedback.submissionId, submissionIds))
      : [];

    // The latest decision on each submission is the one that stands.
    const standing = new Map<string, (typeof decisions)[number]>();
    for (const decision of decisions) if (!standing.has(decision.submissionId)) standing.set(decision.submissionId, decision);

    const summativeDecisions = decisions.filter((decision) => submissions.some((row) => row.id === decision.submissionId && summativeIds.includes(row.assessmentId)));
    const firstDated = summativeDecisions.map((decision) => decision.signedAt).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const assessors = [...new Map(summativeDecisions.map((decision) => [decision.assessorEmail, { name: `${decision.assessorName} ${decision.assessorSurname}`, email: decision.assessorEmail }])).values()];
    const summativeTitle = steps.find((step) => step.purpose === "summative")?.title ?? null;

    const resultOf = (userId: string, attempt: number) => {
      const row = submissions.find((one) => one.userId === userId && one.attempt === attempt && summativeIds.includes(one.assessmentId));
      return row ? standing.get(row.id)?.outcome ?? "submitted" : null;
    };

    return {
      programme: qualification?.title ?? "",
      saqaId: qualification?.saqaId ?? null,
      nqfLevel: qualification?.nqfLevel ?? null,
      credits: qualification?.totalCredits ?? null,
      unit: { code: unit.code, title: unit.title },
      cohort: cohort.name,
      modules: modules.map((row) => row.code),
      assessment: summativeTitle ? { title: summativeTitle, date: firstDated ? firstDated.toISOString().slice(0, 10) : null } : null,
      assessors,
      learners: members.map((member) => {
        const line = attendance.learners.find((one) => one.userId === member.userId);
        const mine = submissions.filter((row) => row.userId === member.userId);
        return {
          userId: member.userId,
          name: `${member.firstName} ${member.lastName}`,
          nationalId: member.nationalId,
          formative: {
            returned: new Set(mine.filter((row) => workbookIds.includes(row.assessmentId) && feedback.some((one) => one.submissionId === row.id)).map((row) => row.assessmentId)).size,
            total: workbookIds.length,
          },
          first: resultOf(member.userId, 1),
          second: resultOf(member.userId, 2),
          overallPercent: line?.overallPercent ?? null,
          toDatePercent: line?.toDatePercent ?? null,
          comments: mine
            .filter((row) => summativeIds.includes(row.assessmentId))
            .map((row) => standing.get(row.id)?.comments)
            .filter((text): text is string => Boolean(text && text.trim())),
        };
      }),
    };
  });
}
