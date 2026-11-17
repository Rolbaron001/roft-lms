/**
 * Every assessed decision a moderator may moderate, and choosing which to
 * sample.
 *
 * Heidi's role specifications (job sheet D52 (3), 17 November 2026): a
 * moderator will "randomly or selectively sample completed evidence and marked
 * assessments". The platform already samples at random as decisions are made
 * (the moderation queue); this lets the moderator see every decision within
 * the programmes they moderate, narrowed by cohort, qualification or
 * assessor, and add any of them to the sample by choice.
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  cohorts,
  courses,
  moderationQueue,
  qualifications,
  studyUnits,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { coursesWithin, inReach, reachWithin, submissionCourse, submissionInReach } from "./staff-scope";
import { assertSessionCan, type AuthenticatedSession } from "./session";

export const CHOSEN = "Chosen by the moderator";

export type DecisionFilter = { cohortId?: string; qualificationId?: string; assessorId?: string };

export type DecisionRow = {
  decisionId: string;
  learner: string;
  assessment: string;
  course: string | null;
  qualification: string | null;
  assessor: string;
  outcome: string;
  decidedAt: Date | null;
  /** In the sample: why, or null when it is not. */
  sampled: string | null;
  /** The moderator's outcome, once moderated. */
  moderated: string | null;
};

const learner = alias(users, "learner");
const assessor = alias(users, "assessor");

export async function decisionsToModerate(session: AuthenticatedSession, filter: DecisionFilter = {}): Promise<DecisionRow[]> {
  assertSessionCan(session, "assessment:moderate");
  return withTenant(session.organisationId, async (tx) => {
    const reach = await reachWithin(tx, session, "moderator");
    const conditions: (SQL | undefined)[] = [
      coursesWithin(reach, submissionCourse),
      // A decision replaced by a later one is not the decision of record.
      sql`not exists (select 1 from assessment_decisions later where later.supersedes_decision_id = ${assessmentDecisions.id})`,
    ];
    if (filter.assessorId) conditions.push(eq(assessmentDecisions.assessorId, filter.assessorId));
    if (filter.qualificationId) conditions.push(eq(studyUnits.qualificationId, filter.qualificationId));
    if (filter.cohortId) {
      conditions.push(sql`exists (
        select 1 from cohort_members cm join cohorts c on c.id = cm.cohort_id
        where cm.cohort_id = ${filter.cohortId} and cm.user_id = ${assessmentSubmissions.userId}
          and (c.course_id = ${courses.id} or c.qualification_id = ${studyUnits.qualificationId}))`);
    }

    const rows = await tx
      .select({
        decisionId: assessmentDecisions.id,
        learnerFirst: learner.firstName,
        learnerLast: learner.lastName,
        assessment: assessments.title,
        course: courses.title,
        qualification: qualifications.title,
        assessorFirst: assessor.firstName,
        assessorLast: assessor.lastName,
        outcome: assessmentDecisions.outcome,
        decidedAt: assessmentDecisions.signedAt,
        sampled: moderationQueue.samplingReason,
        moderated: sql<string | null>`(select m.outcome::text from moderation_records m where m.decision_id = ${assessmentDecisions.id} order by m.actioned_at desc limit 1)`,
      })
      .from(assessmentDecisions)
      .innerJoin(assessmentSubmissions, eq(assessmentSubmissions.id, assessmentDecisions.submissionId))
      .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
      .innerJoin(learner, eq(learner.id, assessmentSubmissions.userId))
      .innerJoin(assessor, eq(assessor.id, assessmentDecisions.assessorId))
      .leftJoin(courses, eq(courses.id, submissionCourse))
      .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .leftJoin(qualifications, eq(qualifications.id, studyUnits.qualificationId))
      .leftJoin(moderationQueue, eq(moderationQueue.decisionId, assessmentDecisions.id))
      .where(and(...conditions))
      .orderBy(desc(assessmentDecisions.signedAt))
      .limit(500);

    return rows.map((row) => ({
      decisionId: row.decisionId,
      learner: `${row.learnerFirst} ${row.learnerLast ?? ""}`.trim(),
      assessment: row.assessment,
      course: row.course,
      qualification: row.qualification,
      assessor: `${row.assessorFirst} ${row.assessorLast ?? ""}`.trim(),
      outcome: row.outcome,
      decidedAt: row.decidedAt,
      sampled: row.sampled,
      moderated: row.moderated,
    }));
  });
}

/** The cohorts, qualifications and assessors to narrow the list by, all within the moderator's reach. */
export async function moderationFilters(session: AuthenticatedSession) {
  assertSessionCan(session, "assessment:moderate");
  const all = await decisionsToModerate(session);
  return withTenant(session.organisationId, async (tx) => {
    const reach = await reachWithin(tx, session, "moderator");
    const cohortRows = await tx.select({ id: cohorts.id, name: cohorts.name }).from(cohorts).orderBy(desc(cohorts.startDate));
    const decisionIds = all.map((row) => row.decisionId);
    const assessorRows = decisionIds.length
      ? await tx
          .selectDistinct({ id: users.id, firstName: users.firstName, lastName: users.lastName })
          .from(assessmentDecisions)
          .innerJoin(users, eq(users.id, assessmentDecisions.assessorId))
          .where(inArray(assessmentDecisions.id, decisionIds))
      : [];
    const qualificationRows = await tx.select({ id: qualifications.id, title: qualifications.title }).from(qualifications).orderBy(qualifications.title);
    const titles = new Set(all.map((row) => row.qualification).filter(Boolean));
    return {
      cohorts: cohortRows.filter((row) => inReach(reach, { cohortId: row.id })),
      qualifications: qualificationRows.filter((row) => titles.has(row.title)),
      assessors: assessorRows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName ?? ""}`.trim() })),
    };
  });
}

/** Adds decisions to the sample by the moderator's choice. Those already in it stay as they are. */
export async function addToSample(session: AuthenticatedSession, decisionIds: string[]): Promise<number> {
  assertSessionCan(session, "assessment:moderate");
  if (decisionIds.length === 0) return 0;
  return withTenant(session.organisationId, async (tx) => {
    const reach = await reachWithin(tx, session, "moderator");
    const decisions = await tx
      .select({ id: assessmentDecisions.id, submissionId: assessmentDecisions.submissionId })
      .from(assessmentDecisions)
      .where(inArray(assessmentDecisions.id, decisionIds));
    let added = 0;
    for (const decision of decisions) {
      if (!(await submissionInReach(tx, reach, decision.submissionId))) continue;
      const made = await tx
        .insert(moderationQueue)
        .values({ organisationId: session.organisationId, decisionId: decision.id, samplingReason: CHOSEN })
        .onConflictDoNothing()
        .returning({ id: moderationQueue.id });
      added += made.length;
    }
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "moderation.sampled_by_choice",
      entityType: "moderation_queue",
      entityId: null,
      after: { decisions: decisionIds.length, added },
    });
    return added;
  });
}
