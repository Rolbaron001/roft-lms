import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { courses, enrolments, studyUnits } from "@/db/schema";
import { awardCompletionBadgeIn } from "./badges";
import { checkEligibility, issueCertificateAutomatically } from "./certificates";
import { issueStudyUnitStatementAutomatically } from "./statement-of-results";

/**
 * What finishing something earns.
 *
 * Roland, 27 September (W3): successful completion of a study unit earns a
 * Statement of Results and the provider's badge, not a certificate. The
 * certificate of competence for a qualification comes from the QCTO after the
 * EISA; until then the walk of 26 September found the platform issuing its own
 * "certificate" for each study unit, five of them before the learner had sat
 * anything external.
 *
 * Everything else keeps its certificate. A short course or an internal
 * programme answers to no qualification, and a certificate is what finishing
 * one earns.
 *
 * "Successful" is the certificate's rule, reused rather than restated: every
 * lesson done, every published summative judged competent, moderation
 * finished. A study unit's badge used to arrive when the lessons were done,
 * before anybody had judged anything; it now waits for the same point.
 *
 * Called when a lesson completes the course and when a moderation finishes.
 * Safe to call again: the badge and the statement are each earned once.
 */
export async function recogniseCompletion(
  organisationId: string,
  enrolmentId: string,
): Promise<void> {
  const unit = await withTenant(organisationId, async (tx) => {
    const [row] = await tx
      .select({
        userId: enrolments.userId,
        courseId: enrolments.courseId,
        studyUnitId: courses.studyUnitId,
        qualificationId: studyUnits.qualificationId,
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(eq(enrolments.id, enrolmentId));
    return row;
  });

  if (!unit?.studyUnitId || !unit.qualificationId) {
    await issueCertificateAutomatically(organisationId, enrolmentId);
    return;
  }

  const earned = await withTenant(organisationId, async (tx) => {
    const eligibility = await checkEligibility(tx, enrolmentId);
    if (!eligibility.eligible) return false;

    await awardCompletionBadgeIn(tx, organisationId, unit.userId, {
      kind: "course",
      id: unit.courseId!,
      completedOn: new Date().toISOString().slice(0, 10),
    });
    return true;
  });

  if (!earned) return;

  // Refused quietly where the unit's criteria are not all achieved yet, which
  // is possible when material outside this course also counts towards them.
  // A person can issue it from the readiness page once they are.
  await issueStudyUnitStatementAutomatically(
    organisationId,
    unit.qualificationId,
    unit.userId,
    unit.studyUnitId,
  );
}
