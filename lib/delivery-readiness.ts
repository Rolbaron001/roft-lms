/**
 * What a qualification still needs before learners work through it, after it
 * is built: its people, a cohort, and learners in the cohort.
 *
 * Roland, 17 November 2026: uploading must start "a whole process, including
 * making sure that material is properly linked and available to students as
 * soon as it becomes properly scheduled through a cohort. Assessors and
 * Facilitators can be assigned, etc." The qualification's step map ended at
 * "Checked and live"; these are the steps after it, each answered from the
 * data rather than from a flag.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { cohortMembers, cohorts, courses, programmeDocuments, programmeStaff, studyUnits } from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";

export type DeliveryReadiness = {
  /** How many people the programme names in each capacity. */
  staff: { facilitator: number; assessor: number; moderator: number };
  cohorts: { id: string; name: string; startDate: string; learners: number }[];
  learners: number;
  /** A roll-out schedule filed with the qualification, which a cohort's plan can be read from. */
  rolloutScheduleFiled: boolean;
};

export async function deliveryReadiness(session: AuthenticatedSession, qualificationId: string): Promise<DeliveryReadiness> {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const named = await tx
      .select({ capacity: programmeStaff.capacity, count: sql<number>`count(distinct ${programmeStaff.userId})::int` })
      .from(programmeStaff)
      .where(eq(programmeStaff.qualificationId, qualificationId))
      .groupBy(programmeStaff.capacity);
    const staff = { facilitator: 0, assessor: 0, moderator: 0 };
    for (const row of named) if (row.capacity in staff) staff[row.capacity as keyof typeof staff] = row.count;

    // A cohort walks the whole qualification, or one of its study units' courses.
    const courseIds = (
      await tx
        .select({ id: courses.id })
        .from(courses)
        .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
        .where(eq(studyUnits.qualificationId, qualificationId))
    ).map((row) => row.id);
    const found = await tx
      .select({ id: cohorts.id, name: cohorts.name, startDate: cohorts.startDate })
      .from(cohorts)
      .where(
        or(
          eq(cohorts.qualificationId, qualificationId),
          courseIds.length ? and(isNull(cohorts.qualificationId), inArray(cohorts.courseId, courseIds)) : sql`false`,
        ),
      )
      .orderBy(cohorts.startDate);
    // Members still in each cohort, counted apart rather than in a correlated
    // subquery, whose outer column did not resolve to the cohort.
    const counts = found.length
      ? await tx
          .select({ cohortId: cohortMembers.cohortId, learners: sql<number>`count(*)::int` })
          .from(cohortMembers)
          .where(and(inArray(cohortMembers.cohortId, found.map((one) => one.id)), isNull(cohortMembers.leftAt)))
          .groupBy(cohortMembers.cohortId)
      : [];
    const rows = found.map((one) => ({ ...one, learners: counts.find((count) => count.cohortId === one.id)?.learners ?? 0 }));

    const [schedule] = await tx
      .select({ id: programmeDocuments.id })
      .from(programmeDocuments)
      .where(and(eq(programmeDocuments.qualificationId, qualificationId), eq(programmeDocuments.kind, "rollout_schedule")))
      .limit(1);

    return {
      staff,
      cohorts: rows.map((row) => ({ ...row, startDate: String(row.startDate) })),
      learners: rows.reduce((sum, row) => sum + row.learners, 0),
      rolloutScheduleFiled: Boolean(schedule),
    };
  });
}
