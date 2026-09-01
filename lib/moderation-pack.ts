import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  accreditationFor,
  qualificationForModule,
  type Accreditation,
} from "./accreditation";
import {
  assessmentDecisions,
  assessmentItems,
  assessmentPapers,
  assessmentSections,
  assessmentSubmissions,
  assessments,
  courseSteps,
  formativeFeedback,
  itemResponses,
  moderationRecords,
  organisations,
  stepOverrides,
  users,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The pack an accreditation visit asks for.
 *
 * Every piece already exists somewhere in the platform. What was missing was
 * the one action that puts them together, which is why a moderation visit
 * currently means somebody spending two days assembling folders — and why the
 * folder they assemble is a selection nobody else can check.
 *
 * Two things this deliberately does *not* do. It does not choose a flattering
 * sample: scripts are taken across the mark range, top, middle and bottom, so
 * a moderator sees the marking at its best and its worst. And it does not omit
 * the awkward parts: an overturned decision, an assessor who departed from
 * what the marks proposed, a learner let past a gate by an override. Those are
 * the first things a moderator would ask for, and a pack that leaves them out
 * is worse than no pack at all.
 */

export type PackScript = {
  submissionId: string;
  learner: string;
  attemptNumber: number;
  marksAwarded: number;
  marksAvailable: number;
  percentage: number;
  outcome: string | null;
  /** Set where the assessor departed from what the marks proposed. */
  departures: {
    criterionId: string;
    proposed: string;
    decided: string;
    reason: string | null;
  }[];
  moderation: {
    outcome: string;
    revisedOutcome: string | null;
    comments: string | null;
    moderator: string;
  } | null;
};

export type ModerationPack = {
  provider: { name: string; accreditationNumber: string | null };
  /**
   * The accreditation this assessment is offered under. The qualification's
   * own number where it has one, the provider's where it does not, and which
   * of the two it is, because a moderator checks this against an accreditation
   * letter and one letter covers several qualifications.
   */
  accreditation: Accreditation;
  assessment: {
    id: string;
    title: string;
    purpose: string;
    passMark: number;
    moderationSampleRate: number;
  };
  papers: {
    code: string;
    sections: { title: string; markTotal: number | null; questions: number }[];
  }[];
  /** Every question with the guidance an assessor marked it against. */
  memorandum: {
    stem: string;
    points: number;
    markingGuide: string | null;
    correctOption: string | null;
  }[];
  /** Scripts across the range, not a flattering selection. */
  scripts: PackScript[];
  /** Decisions a moderator overturned or sent back. */
  overturned: PackScript[];
  /** Learners let past a gate by a named exception. */
  overrides: {
    learner: string;
    stepTitle: string | null;
    reason: string;
    grantedBy: string;
    grantedAt: Date;
    revokedAt: Date | null;
  }[];
  counts: {
    submissions: number;
    decided: number;
    moderated: number;
    sampled: number;
  };
  assembledAt: Date;
};

/**
 * Picks scripts across the mark range rather than at random.
 *
 * A random sample of five can be five middling scripts, which tells a
 * moderator nothing about how the extremes were handled. Top, bottom and
 * spread through the middle is what shows whether the marking held.
 */
function spread<T>(rows: T[], take: number): T[] {
  if (rows.length <= take) return rows;

  const picked: T[] = [rows[0], rows[rows.length - 1]];
  const remaining = take - 2;
  if (remaining > 0) {
    const stride = (rows.length - 1) / (remaining + 1);
    for (let index = 1; index <= remaining; index += 1) {
      picked.push(rows[Math.round(index * stride)]);
    }
  }

  // De-duplicated in case the stride lands on an end, and back into mark order.
  return [...new Set(picked)].sort(
    (a, b) =>
      (b as { percentage: number }).percentage -
      (a as { percentage: number }).percentage,
  );
}

export async function assembleModerationPack(
  session: AuthenticatedSession,
  assessmentId: string,
  options: { sampleSize?: number } = {},
): Promise<ModerationPack> {
  // A moderator assembles this; so may an external verifier, who can read
  // everything in a tenant and change nothing.
  assertSessionCan(session, "assessment:moderate");

  return withTenant(session.organisationId, async (tx) =>
    build(tx, session.organisationId, assessmentId, options.sampleSize ?? 6),
  );
}

async function build(
  tx: TenantDatabase,
  organisationId: string,
  assessmentId: string,
  sampleSize: number,
): Promise<ModerationPack> {
  const [organisation] = await tx
    .select({
      name: organisations.displayName,
      accreditationNumber: organisations.accreditationNumber,
    })
    .from(organisations)
    .where(eq(organisations.id, organisationId));

  const [assessment] = await tx
    .select()
    .from(assessments)
    .where(eq(assessments.id, assessmentId));

  if (!assessment) {
    throw new Error("No such assessment.");
  }

  const accreditation = await accreditationFor(
    tx,
    organisationId,
    await qualificationForModule(tx, assessment.curriculumModuleId),
  );

  // --- the instrument -------------------------------------------------------
  const papers = await tx
    .select()
    .from(assessmentPapers)
    .where(eq(assessmentPapers.assessmentId, assessmentId))
    .orderBy(asc(assessmentPapers.sortOrder));

  const sections = papers.length
    ? await tx
        .select()
        .from(assessmentSections)
        .where(
          inArray(
            assessmentSections.paperId,
            papers.map((paper) => paper.id),
          ),
        )
        .orderBy(asc(assessmentSections.sortOrder))
    : [];

  const items = await tx
    .select()
    .from(assessmentItems)
    .where(eq(assessmentItems.assessmentId, assessmentId))
    .orderBy(asc(assessmentItems.sortOrder));

  // --- the scripts ----------------------------------------------------------
  const submissions = await tx
    .select({
      id: assessmentSubmissions.id,
      userId: assessmentSubmissions.userId,
      attemptNumber: assessmentSubmissions.attemptNumber,
      status: assessmentSubmissions.status,
      firstName: users.firstName,
      lastName: users.lastName,
      decisionId: assessmentDecisions.id,
      outcome: assessmentDecisions.outcome,
      criterionOutcomes: assessmentDecisions.criterionOutcomes,
      criterionProposed: assessmentDecisions.criterionProposed,
      criterionNotes: assessmentDecisions.criterionNotes,
    })
    .from(assessmentSubmissions)
    .innerJoin(users, eq(users.id, assessmentSubmissions.userId))
    .leftJoin(
      assessmentDecisions,
      eq(assessmentDecisions.submissionId, assessmentSubmissions.id),
    )
    .where(
      and(
        eq(assessmentSubmissions.assessmentId, assessmentId),
        inArray(assessmentSubmissions.status, [
          "submitted",
          "assessed",
          "moderated",
          "referred_back",
          "finalised",
        ]),
      ),
    )
    .orderBy(desc(assessmentSubmissions.submittedAt));

  const submissionIds = submissions.map((row) => row.id);

  const responses = submissionIds.length
    ? await tx
        .select()
        .from(itemResponses)
        .where(inArray(itemResponses.submissionId, submissionIds))
    : [];

  const moderations = submissionIds.length
    ? await tx
        .select({
          decisionId: moderationRecords.decisionId,
          outcome: moderationRecords.outcome,
          revisedOutcome: moderationRecords.revisedOutcome,
          comments: moderationRecords.comments,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(moderationRecords)
        .innerJoin(users, eq(users.id, moderationRecords.moderatorId))
    : [];

  const totalMarks = items.reduce((sum, item) => sum + item.points, 0);

  const scripts: PackScript[] = submissions.map((row) => {
    const own = responses.filter((response) => response.submissionId === row.id);
    const awarded = own.reduce(
      (sum, response) => sum + Number(response.awardedMarks ?? 0),
      0,
    );

    const departures = Object.entries(row.criterionOutcomes ?? {})
      .filter(([criterionId, decided]) => {
        const proposed = row.criterionProposed?.[criterionId];
        return proposed !== undefined && proposed !== decided;
      })
      .map(([criterionId, decided]) => ({
        criterionId,
        proposed: row.criterionProposed![criterionId],
        decided,
        reason: row.criterionNotes?.[criterionId] ?? null,
      }));

    const moderation = moderations.find(
      (record) => record.decisionId === row.decisionId,
    );

    return {
      submissionId: row.id,
      learner: `${row.firstName} ${row.lastName}`,
      attemptNumber: row.attemptNumber,
      marksAwarded: awarded,
      marksAvailable: totalMarks,
      percentage: totalMarks === 0 ? 0 : (awarded / totalMarks) * 100,
      outcome: row.outcome,
      departures,
      moderation: moderation
        ? {
            outcome: moderation.outcome,
            revisedOutcome: moderation.revisedOutcome,
            comments: moderation.comments,
            moderator: `${moderation.firstName} ${moderation.lastName}`,
          }
        : null,
    };
  });

  const byMark = [...scripts].sort((a, b) => b.percentage - a.percentage);

  // --- the awkward parts ----------------------------------------------------
  const overturned = scripts.filter(
    (script) =>
      script.moderation?.outcome === "overridden" ||
      script.moderation?.outcome === "referred_back" ||
      script.departures.length > 0,
  );

  const overrideRows = await tx
    .select({
      reason: stepOverrides.reason,
      grantedAt: stepOverrides.grantedAt,
      revokedAt: stepOverrides.revokedAt,
      stepTitle: courseSteps.title,
      learnerFirst: users.firstName,
      learnerLast: users.lastName,
    })
    .from(stepOverrides)
    .innerJoin(courseSteps, eq(courseSteps.id, stepOverrides.stepId))
    .innerJoin(users, eq(users.id, stepOverrides.userId))
    .where(eq(courseSteps.assessmentId, assessmentId));

  const granters = await tx
    .select({
      id: stepOverrides.id,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(stepOverrides)
    .innerJoin(users, eq(users.id, stepOverrides.grantedById))
    .innerJoin(courseSteps, eq(courseSteps.id, stepOverrides.stepId))
    .where(eq(courseSteps.assessmentId, assessmentId));

  return {
    provider: {
      name: organisation?.name ?? "",
      accreditationNumber: organisation?.accreditationNumber ?? null,
    },
    accreditation,
    assessment: {
      id: assessment.id,
      title: assessment.title,
      purpose: assessment.purpose,
      passMark: assessment.passMark,
      moderationSampleRate: Number(assessment.moderationSampleRate),
    },
    papers: papers.map((paper) => ({
      code: paper.code,
      sections: sections
        .filter((section) => section.paperId === paper.id)
        .map((section) => ({
          title: section.title,
          markTotal: section.markTotal,
          questions: items.filter((item) => item.sectionId === section.id).length,
        })),
    })),
    memorandum: items.map((item) => ({
      stem: item.stem,
      points: item.points,
      markingGuide: item.markingGuide,
      correctOption:
        item.correctOptionIds && item.options
          ? (item.options.find(
              (option) => option.id === item.correctOptionIds![0],
            )?.text ?? null)
          : null,
    })),
    scripts: spread(byMark, sampleSize),
    overturned,
    overrides: overrideRows.map((row, index) => ({
      learner: `${row.learnerFirst} ${row.learnerLast}`,
      stepTitle: row.stepTitle,
      reason: row.reason,
      grantedBy: granters[index]
        ? `${granters[index].firstName} ${granters[index].lastName}`
        : "",
      grantedAt: row.grantedAt,
      revokedAt: row.revokedAt,
    })),
    counts: {
      submissions: submissions.length,
      decided: submissions.filter((row) => row.decisionId !== null).length,
      moderated: moderations.length,
      sampled: Math.min(sampleSize, scripts.length),
    },
    assembledAt: new Date(),
  };
}

/**
 * A learner's own record for one attempt: the questions, what they wrote, what
 * it earned and who said so.
 *
 * The artefact a verifier asks for by name. Produced from the record rather
 * than reconstructed later from memory, and rendered as an ordinary page so it
 * prints from any browser — a PDF library would add a dependency to solve a
 * problem the print dialog already solves.
 */
export type PortfolioRecord = {
  learner: string;
  assessmentTitle: string;
  purpose: string;
  attemptNumber: number;
  submittedAt: Date | null;
  declarationText: string | null;
  declarationAcceptedAt: Date | null;
  closedOnTime: boolean;
  items: {
    stem: string;
    points: number;
    answer: string;
    awarded: number | null;
    comment: string | null;
  }[];
  marksAwarded: number;
  marksAvailable: number;
  decision: {
    outcome: string;
    comments: string | null;
    assessor: string;
    registrationNumber: string | null;
    signedAt: Date;
  } | null;
  moderation: {
    outcome: string;
    comments: string | null;
    moderator: string;
  } | null;
  feedback: { comments: string; returnedAt: Date } | null;
};

export async function portfolioRecord(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<PortfolioRecord> {
  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, submissionId));

    if (!submission) throw new Error("No such attempt.");

    // A learner may take their own record; anyone else needs to be entitled to
    // read other people's evidence.
    if (submission.userId !== session.userId) {
      assertSessionCan(session, "evidence:read_all");
    }

    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, submission.assessmentId));

    const [learner] = await tx
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, submission.userId));

    const items = await tx
      .select()
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, submission.assessmentId))
      .orderBy(asc(assessmentItems.sortOrder));

    const responses = await tx
      .select()
      .from(itemResponses)
      .where(eq(itemResponses.submissionId, submissionId));

    const [decision] = await tx
      .select({
        outcome: assessmentDecisions.outcome,
        comments: assessmentDecisions.comments,
        signedAt: assessmentDecisions.signedAt,
        registrationNumber: assessmentDecisions.assessorRegistrationNumber,
        id: assessmentDecisions.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(assessmentDecisions)
      .innerJoin(users, eq(users.id, assessmentDecisions.assessorId))
      .where(eq(assessmentDecisions.submissionId, submissionId));

    const [moderation] = decision
      ? await tx
          .select({
            outcome: moderationRecords.outcome,
            comments: moderationRecords.comments,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(moderationRecords)
          .innerJoin(users, eq(users.id, moderationRecords.moderatorId))
          .where(eq(moderationRecords.decisionId, decision.id))
      : [];

    const [feedback] = await tx
      .select()
      .from(formativeFeedback)
      .where(eq(formativeFeedback.submissionId, submissionId));

    const byItem = new Map(responses.map((row) => [row.itemId, row]));

    const rendered = items.map((item) => {
      const response = byItem.get(item.id);
      const chosen = response?.selectedOptionIds ?? [];
      const answer = chosen.length
        ? chosen
            .map(
              (id) =>
                item.options?.find((option) => option.id === id)?.text ?? id,
            )
            .join(", ")
        : (response?.answerText ??
          (response?.answerNumber !== null && response?.answerNumber !== undefined
            ? String(response.answerNumber)
            : "— left blank —"));

      return {
        stem: item.stem,
        points: item.points,
        answer,
        awarded:
          response?.awardedMarks != null ? Number(response.awardedMarks) : null,
        comment: response?.assessorComment ?? null,
      };
    });

    return {
      learner: `${learner.firstName} ${learner.lastName}`,
      assessmentTitle: assessment.title,
      purpose: assessment.purpose,
      attemptNumber: submission.attemptNumber,
      submittedAt: submission.submittedAt,
      declarationText: submission.declarationText,
      declarationAcceptedAt: submission.declarationAcceptedAt,
      closedOnTime: submission.closedOnTime,
      items: rendered,
      marksAwarded: rendered.reduce((sum, item) => sum + (item.awarded ?? 0), 0),
      marksAvailable: rendered.reduce((sum, item) => sum + item.points, 0),
      decision: decision
        ? {
            outcome: decision.outcome,
            comments: decision.comments,
            assessor: `${decision.firstName} ${decision.lastName}`,
            registrationNumber: decision.registrationNumber,
            signedAt: decision.signedAt,
          }
        : null,
      moderation: moderation
        ? {
            outcome: moderation.outcome,
            comments: moderation.comments,
            moderator: `${moderation.firstName} ${moderation.lastName}`,
          }
        : null,
      feedback: feedback
        ? { comments: feedback.comments, returnedAt: feedback.returnedAt }
        : null,
    };
  });
}
