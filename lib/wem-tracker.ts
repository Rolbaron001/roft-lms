import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { cohortMembers, cohorts, courses, curriculumModules, studyUnits, users, workplaceLogbooks } from "@/db/schema";
import { cohortCourseIds } from "./schedule";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Work experience across a cohort (job sheet D20): each learner against each
 * workplace module of the qualification, with how far the logbook has got and
 * the hours recorded. Curiosa track this in the WEM folder of the cohort; here
 * it is read from the logbooks themselves, so nobody keeps a second copy.
 */

export type WemStage = "none" | "draft" | "submitted_to_coach" | "returned_by_coach" | "coach_signed" | "accepted_by_assessor";

export type WemTracker = {
  modules: { id: string; code: string; title: string; notionalHours: number | null }[];
  learners: { userId: string; name: string; cells: { moduleId: string; stage: WemStage; hours: number | null }[] }[];
};

export async function cohortWem(session: AuthenticatedSession, cohortId: string): Promise<WemTracker> {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) return { modules: [], learners: [] };

    // The qualification is the cohort's own, or the one its course belongs to.
    let qualificationId = cohort.qualificationId;
    if (!qualificationId) {
      const courseIds = await cohortCourseIds(tx, cohort);
      const [row] = courseIds.length
        ? await tx
            .select({ id: studyUnits.qualificationId })
            .from(courses)
            .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
            .where(inArray(courses.id, courseIds))
        : [];
      qualificationId = row?.id ?? null;
    }
    if (!qualificationId) return { modules: [], learners: [] };

    const modules = await tx
      .select({ id: curriculumModules.id, code: curriculumModules.code, title: curriculumModules.title, notionalHours: curriculumModules.notionalHours })
      .from(curriculumModules)
      .where(and(eq(curriculumModules.qualificationId, qualificationId), eq(curriculumModules.component, "workplace")))
      .orderBy(asc(curriculumModules.sortOrder), asc(curriculumModules.code));
    if (modules.length === 0) return { modules: [], learners: [] };

    const members = await tx
      .select({ userId: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)))
      .orderBy(asc(users.lastName), asc(users.firstName));
    const memberIds = members.map((member) => member.userId);

    const books = memberIds.length
      ? await tx
          .select({
            learnerId: workplaceLogbooks.learnerId,
            moduleId: workplaceLogbooks.curriculumModuleId,
            status: workplaceLogbooks.status,
            hours: workplaceLogbooks.hoursClaimed,
            updatedAt: workplaceLogbooks.updatedAt,
          })
          .from(workplaceLogbooks)
          .where(and(inArray(workplaceLogbooks.learnerId, memberIds), inArray(workplaceLogbooks.curriculumModuleId, modules.map((module) => module.id))))
      : [];

    return {
      modules,
      learners: members.map((member) => ({
        userId: member.userId,
        name: `${member.firstName} ${member.lastName}`,
        cells: modules.map((module) => {
          // A learner may have restarted a logbook; the latest one stands.
          const book = books
            .filter((one) => one.learnerId === member.userId && one.moduleId === module.id)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
          return { moduleId: module.id, stage: book ? book.status : "none", hours: book?.hours ?? null };
        }),
      })),
    };
  });
}
