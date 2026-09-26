import { and, desc, eq, ne } from "drizzle-orm";
import type { TenantDatabase } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  moderationRecords,
} from "@/db/schema";

/**
 * Whether a learner already stands competent on an assessment.
 *
 * Roland, 27 September: a learner found competent has no reason to sit the
 * summative again, so the platform does not offer it. Found by the walk of
 * 26 September, where a learner judged competent and moderated was shown the
 * paper and a Submit button, and a second attempt went to the assessor as new
 * work.
 *
 * Competent means an attempt whose standing outcome is competent: the
 * moderator's revision where there is one, otherwise the assessor's decision.
 * A decision still waiting for moderation counts, since there is nothing to
 * resit while it stands. A decision a moderator referred back does not, and
 * neither does one overridden to not yet competent: then the learner may need
 * another attempt, and the ordinary rules about attempts decide it.
 *
 * Used by both routes a summative is taken by, the captured paper and the quiz
 * built on the platform, so they cannot come to different answers.
 */
export async function alreadyCompetent(
  tx: TenantDatabase,
  assessmentId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .select({
      decisionOutcome: assessmentDecisions.outcome,
      moderationOutcome: moderationRecords.outcome,
      revisedOutcome: moderationRecords.revisedOutcome,
    })
    .from(assessmentSubmissions)
    .innerJoin(
      assessmentDecisions,
      eq(assessmentDecisions.submissionId, assessmentSubmissions.id),
    )
    .leftJoin(moderationRecords, eq(moderationRecords.decisionId, assessmentDecisions.id))
    .where(
      and(
        eq(assessmentSubmissions.assessmentId, assessmentId),
        eq(assessmentSubmissions.userId, userId),
        ne(assessmentSubmissions.status, "referred_back"),
      ),
    )
    .orderBy(desc(assessmentDecisions.signedAt));

  return rows.some((row) => {
    const outcome =
      row.moderationOutcome === "overridden" && row.revisedOutcome
        ? row.revisedOutcome
        : row.decisionOutcome;
    return outcome === "competent";
  });
}

export const ALREADY_COMPETENT_MESSAGE =
  "You have already been found competent on this assessment, so there is nothing to sit again.";
