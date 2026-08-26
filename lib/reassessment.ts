import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentItemCriteria,
  assessmentItems,
  assessmentPapers,
  assessmentSections,
  assessmentSubmissions,
  assessments,
  oralAssessmentRecords,
  reassessmentAuthorisations,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The third attempt.
 *
 * Two not-yet-competent results do not fail a learner. The step is *held*, and
 * a programme review is convened with the employer before anything further
 * happens — because by the second failure the useful question is rarely "does
 * this person know it" and usually "what has been going on around them", and
 * the employer is the only party who can answer that.
 *
 * The review can decide three things: put them through further learning, take
 * them off the programme, or authorise a third attempt conducted orally. Only
 * the last opens anything, and it opens exactly one attempt.
 *
 * What the oral attempt is *not* is a softer route to competence. It produces
 * an ordinary submission, judged by an ordinary assessor decision, against the
 * same criteria, reaching the criterion ledger by the same path as a written
 * attempt. The only thing that differs is that the evidence is a written
 * record of what was asked and answered, rather than a paper — because an oral
 * assessment leaves no evidence of its own unless somebody writes it down.
 */

export class ReassessmentError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "not_held"
      | "not_authorised"
      | "already_used"
      | "conflict"
      | "invalid",
  ) {
    super(message);
    this.name = "ReassessmentError";
  }
}

/**
 * How many not-yet-competent results before the step is held.
 *
 * Two, matching the two written papers an assessment carries. The third
 * attempt is the oral one, and it does not happen without a review.
 */
export const ATTEMPTS_BEFORE_REVIEW = 2;

export type ReassessmentState = {
  attempts: number;
  notYetCompetent: number;
  /** Two failures and no review yet: nothing further can be sat. */
  held: boolean;
  authorisation: {
    id: string;
    outcome: "oral_reassessment" | "further_learning" | "withdrawn";
    rationale: string;
    reviewedById: string;
    reviewedAt: Date;
    employerConsulted: boolean;
    employerRepresentative: string | null;
    submissionId: string | null;
  } | null;
  /** An authorised oral attempt that has not yet been sat. */
  oralAvailable: boolean;
};

/**
 * Where a learner stands on one assessment.
 *
 * Held is derived rather than stored. A stored flag is a second source of
 * truth about something the decisions already say, and the two drift: a
 * decision corrected after a referral back would leave the flag behind.
 */
export async function reassessmentState(
  session: AuthenticatedSession,
  assessmentId: string,
  userId: string,
): Promise<ReassessmentState> {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const submissions = await tx
      .select({ id: assessmentSubmissions.id })
      .from(assessmentSubmissions)
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, assessmentId),
          eq(assessmentSubmissions.userId, userId),
        ),
      );

    const decisions =
      submissions.length === 0
        ? []
        : await tx
            .select({
              outcome: assessmentDecisions.outcome,
              submissionId: assessmentDecisions.submissionId,
            })
            .from(assessmentDecisions)
            .where(
              inArray(
                assessmentDecisions.submissionId,
                submissions.map((row) => row.id),
              ),
            );

    // The latest decision per submission, because a referral back can produce
    // a second decision on the same attempt and only the surviving one counts.
    const latest = new Map<string, string>();
    for (const decision of decisions) {
      latest.set(decision.submissionId, decision.outcome);
    }

    const outcomes = [...latest.values()];
    const notYetCompetent = outcomes.filter(
      (outcome) => outcome === "not_yet_competent",
    ).length;
    const competent = outcomes.some((outcome) => outcome === "competent");

    const [authorisation] = await tx
      .select()
      .from(reassessmentAuthorisations)
      .where(
        and(
          eq(reassessmentAuthorisations.assessmentId, assessmentId),
          eq(reassessmentAuthorisations.userId, userId),
        ),
      )
      .orderBy(desc(reassessmentAuthorisations.reviewedAt))
      .limit(1);

    const held =
      !competent &&
      notYetCompetent >= ATTEMPTS_BEFORE_REVIEW &&
      !authorisation;

    return {
      attempts: submissions.length,
      notYetCompetent,
      held,
      authorisation: authorisation
        ? {
            id: authorisation.id,
            outcome: authorisation.outcome,
            rationale: authorisation.rationale,
            reviewedById: authorisation.reviewedById,
            reviewedAt: authorisation.reviewedAt,
            employerConsulted: authorisation.employerConsulted,
            employerRepresentative: authorisation.employerRepresentative,
            submissionId: authorisation.submissionId,
          }
        : null,
      oralAvailable:
        !competent &&
        authorisation?.outcome === "oral_reassessment" &&
        authorisation.submissionId === null,
    };
  });
}

export const authorisationInput = z.object({
  assessmentId: z.string().uuid(),
  userId: z.string().uuid(),
  outcome: z.enum(["oral_reassessment", "further_learning", "withdrawn"]),
  rationale: z.string().trim().min(10).max(4000),
  employerConsulted: z.boolean().default(false),
  employerRepresentative: z.string().trim().max(200).optional(),
  employerComments: z.string().trim().max(4000).optional(),
});

/**
 * Records what the programme review decided.
 *
 * Held by `enrolment:manage` rather than `assessment:assess` on purpose: this
 * is a programme decision about a learner's route, taken with their employer,
 * not an assessment judgement. The person who assesses the oral attempt is
 * somebody else — and `startOralAttempt` refuses if it is not.
 */
export async function authoriseReassessment(
  session: AuthenticatedSession,
  input: z.infer<typeof authorisationInput>,
) {
  assertSessionCan(session, "enrolment:manage");
  const parsed = authorisationInput.parse(input);

  if (parsed.employerConsulted && !parsed.employerRepresentative) {
    throw new ReassessmentError(
      "Name the person at the employer who was consulted. An unnamed employer is not evidence that a consultation happened.",
      "invalid",
    );
  }

  const state = await reassessmentState(
    session,
    parsed.assessmentId,
    parsed.userId,
  );

  if (state.authorisation) {
    throw new ReassessmentError(
      "This learner has already been through a programme review on this assessment.",
      "conflict",
    );
  }

  if (!state.held) {
    throw new ReassessmentError(
      state.notYetCompetent >= ATTEMPTS_BEFORE_REVIEW
        ? "This learner has already been found competent on this assessment."
        : `A programme review follows ${ATTEMPTS_BEFORE_REVIEW} not-yet-competent results. This learner has ${state.notYetCompetent}.`,
      "not_held",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(reassessmentAuthorisations)
      .values({
        organisationId: session.organisationId,
        assessmentId: parsed.assessmentId,
        userId: parsed.userId,
        reviewedById: session.userId,
        outcome: parsed.outcome,
        rationale: parsed.rationale,
        employerConsulted: parsed.employerConsulted,
        employerRepresentative: parsed.employerRepresentative ?? null,
        employerComments: parsed.employerComments ?? null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "reassessment.authorised",
      entityType: "reassessment_authorisation",
      entityId: created.id,
      after: {
        assessmentId: parsed.assessmentId,
        userId: parsed.userId,
        outcome: parsed.outcome,
        employerConsulted: parsed.employerConsulted,
        employerRepresentative: parsed.employerRepresentative ?? null,
      },
    });

    return created;
  });
}

/**
 * Opens the oral attempt the review authorised.
 *
 * Started by the assessor rather than the learner: an oral assessment is
 * conducted, not sat. The submission it creates is an ordinary one, so the
 * decision on it goes through the ordinary route and lands in the ledger
 * beside the two written attempts rather than beside them in some other form.
 */
export async function startOralAttempt(
  session: AuthenticatedSession,
  authorisationId: string,
) {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, async (tx) => {
    const [authorisation] = await tx
      .select()
      .from(reassessmentAuthorisations)
      .where(eq(reassessmentAuthorisations.id, authorisationId));

    if (!authorisation) {
      throw new ReassessmentError("No such authorisation.", "not_found");
    }

    if (authorisation.outcome !== "oral_reassessment") {
      throw new ReassessmentError(
        `That review decided on ${authorisation.outcome.replace(/_/g, " ")}, not an oral reassessment.`,
        "not_authorised",
      );
    }

    if (authorisation.submissionId) {
      throw new ReassessmentError(
        "That authorisation has already been used. A third attempt granted twice is not a third attempt.",
        "already_used",
      );
    }

    // The person who decided the learner deserved another attempt does not
    // then judge it. The platform separates assessment from moderation for the
    // same reason, and this is the same conflict wearing a different hat.
    if (authorisation.reviewedById === session.userId) {
      throw new ReassessmentError(
        "You authorised this third attempt, so somebody else must conduct it.",
        "conflict",
      );
    }

    if (authorisation.userId === session.userId) {
      throw new ReassessmentError(
        "You cannot conduct your own oral assessment.",
        "conflict",
      );
    }

    const attempts = await tx
      .select({ attemptNumber: assessmentSubmissions.attemptNumber })
      .from(assessmentSubmissions)
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, authorisation.assessmentId),
          eq(assessmentSubmissions.userId, authorisation.userId),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber));

    const attemptNumber = (attempts[0]?.attemptNumber ?? 0) + 1;

    // An oral paper if the assessment has one, and nothing if it does not.
    // The attempt draws no items either way: the assessor works from the
    // criteria, which is what the record below is organised around.
    const [oralPaper] = await tx
      .select({ id: assessmentPapers.id })
      .from(assessmentPapers)
      .where(
        and(
          eq(assessmentPapers.assessmentId, authorisation.assessmentId),
          eq(assessmentPapers.mode, "oral"),
          eq(assessmentPapers.status, "published"),
        ),
      )
      .limit(1);

    const [submission] = await tx
      .insert(assessmentSubmissions)
      .values({
        organisationId: session.organisationId,
        assessmentId: authorisation.assessmentId,
        userId: authorisation.userId,
        attemptNumber,
        status: "submitted",
        paperId: oralPaper?.id ?? null,
        startedAt: new Date(),
        submittedAt: new Date(),
        invigilatorId: session.userId,
      })
      .returning();

    await tx
      .update(reassessmentAuthorisations)
      .set({ submissionId: submission.id })
      .where(eq(reassessmentAuthorisations.id, authorisationId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "reassessment.oral_started",
      entityType: "assessment_submission",
      entityId: submission.id,
      after: {
        authorisationId,
        attemptNumber,
        learnerId: authorisation.userId,
      },
    });

    return submission;
  });
}

export const oralRecordInput = z.object({
  submissionId: z.string().uuid(),
  medium: z.string().trim().max(200).optional(),
  witnessName: z.string().trim().max(200).optional(),
  exchanges: z
    .array(
      z.object({
        criterionId: z.string().uuid().optional(),
        question: z.string().trim().min(3).max(2000),
        response: z.string().trim().min(1).max(4000),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .min(1),
});

/**
 * Writes down what was asked and what was answered.
 *
 * Separate from the decision, and required before one can be recorded — see
 * `assertOralRecorded`. An oral pass with no record of the exchange is a claim
 * rather than evidence, and it is the claim a verifier will pull first.
 */
export async function recordOralAssessment(
  session: AuthenticatedSession,
  input: z.infer<typeof oralRecordInput>,
) {
  assertSessionCan(session, "assessment:assess");
  const parsed = oralRecordInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [authorisation] = await tx
      .select()
      .from(reassessmentAuthorisations)
      .where(eq(reassessmentAuthorisations.submissionId, parsed.submissionId));

    if (!authorisation) {
      throw new ReassessmentError(
        "That attempt is not an authorised oral reassessment.",
        "not_authorised",
      );
    }

    if (authorisation.userId === session.userId) {
      throw new ReassessmentError(
        "You cannot conduct your own oral assessment.",
        "conflict",
      );
    }

    const [existing] = await tx
      .select({ id: oralAssessmentRecords.id })
      .from(oralAssessmentRecords)
      .where(eq(oralAssessmentRecords.submissionId, parsed.submissionId));

    const values = {
      medium: parsed.medium ?? null,
      witnessName: parsed.witnessName ?? null,
      exchanges: parsed.exchanges,
    };

    const [record] = existing
      ? await tx
          .update(oralAssessmentRecords)
          .set(values)
          .where(eq(oralAssessmentRecords.id, existing.id))
          .returning()
      : await tx
          .insert(oralAssessmentRecords)
          .values({
            organisationId: session.organisationId,
            authorisationId: authorisation.id,
            submissionId: parsed.submissionId,
            assessorId: session.userId,
            ...values,
          })
          .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: existing
        ? "reassessment.oral_record_amended"
        : "reassessment.oral_recorded",
      entityType: "oral_assessment_record",
      entityId: record.id,
      after: { exchanges: parsed.exchanges.length },
    });

    return record;
  });
}

/**
 * Refuses a decision on an oral attempt that has no record behind it.
 *
 * Called from the decision path rather than left to the screen, because the
 * screen is not the only way in and this is the guarantee that makes an oral
 * pass defensible.
 */
export async function assertOralRecorded(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<void> {
  await withTenant(session.organisationId, async (tx) => {
    const [authorisation] = await tx
      .select({ id: reassessmentAuthorisations.id })
      .from(reassessmentAuthorisations)
      .where(eq(reassessmentAuthorisations.submissionId, submissionId));

    // Not an oral attempt at all, so nothing to require.
    if (!authorisation) return;

    const [record] = await tx
      .select({ id: oralAssessmentRecords.id })
      .from(oralAssessmentRecords)
      .where(eq(oralAssessmentRecords.submissionId, submissionId));

    if (!record) {
      throw new ReassessmentError(
        "Write down what was asked and answered before recording the outcome. An oral pass with no record of the exchange is not evidence.",
        "invalid",
      );
    }
  });
}

/** One oral attempt, for the assessor conducting it and the moderator reading it. */
export async function oralAssessmentFor(
  session: AuthenticatedSession,
  submissionId: string,
) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        authorisation: reassessmentAuthorisations,
        submission: assessmentSubmissions,
        assessmentTitle: assessments.title,
      })
      .from(reassessmentAuthorisations)
      .innerJoin(
        assessmentSubmissions,
        eq(assessmentSubmissions.id, reassessmentAuthorisations.submissionId),
      )
      .innerJoin(
        assessments,
        eq(assessments.id, reassessmentAuthorisations.assessmentId),
      )
      .where(eq(reassessmentAuthorisations.submissionId, submissionId));

    if (!row) {
      throw new ReassessmentError(
        "That attempt is not an authorised oral reassessment.",
        "not_found",
      );
    }

    const [record] = await tx
      .select()
      .from(oralAssessmentRecords)
      .where(eq(oralAssessmentRecords.submissionId, submissionId));

    const [learner] = await tx
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, row.authorisation.userId));

    return { ...row, record: record ?? null, learner };
  });
}

/**
 * Everybody whose progress is held, and everybody with an oral attempt waiting.
 *
 * The reason this list exists: a held learner is, from their own screen,
 * simply stuck. Nothing prompts anybody unless the people who can convene a
 * review can see who is waiting for one.
 */
export async function listHeldAndAuthorised(session: AuthenticatedSession) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const failures = await tx
      .select({
        assessmentId: assessmentSubmissions.assessmentId,
        userId: assessmentSubmissions.userId,
        submissionId: assessmentSubmissions.id,
        outcome: assessmentDecisions.outcome,
        assessmentTitle: assessments.title,
        purpose: assessments.purpose,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(assessmentDecisions)
      .innerJoin(
        assessmentSubmissions,
        eq(assessmentSubmissions.id, assessmentDecisions.submissionId),
      )
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentSubmissions.assessmentId),
      )
      .innerJoin(users, eq(users.id, assessmentSubmissions.userId));

    // Grouped in memory rather than in SQL: the counting rule is "the latest
    // decision on each attempt", which is awkward to express in one query and
    // trivial here, and this is a handful of rows per tenant.
    const perLearner = new Map<
      string,
      {
        assessmentId: string;
        userId: string;
        assessmentTitle: string;
        firstName: string;
        lastName: string;
        outcomes: Map<string, string>;
      }
    >();

    for (const row of failures) {
      if (row.purpose !== "summative") continue;

      const key = `${row.assessmentId}:${row.userId}`;
      const entry = perLearner.get(key) ?? {
        assessmentId: row.assessmentId,
        userId: row.userId,
        assessmentTitle: row.assessmentTitle,
        firstName: row.firstName,
        lastName: row.lastName,
        outcomes: new Map<string, string>(),
      };
      entry.outcomes.set(row.submissionId, row.outcome);
      perLearner.set(key, entry);
    }

    const authorisations = await tx.select().from(reassessmentAuthorisations);
    const byKey = new Map(
      authorisations.map((row) => [`${row.assessmentId}:${row.userId}`, row]),
    );

    const held: {
      assessmentId: string;
      assessmentTitle: string;
      userId: string;
      firstName: string;
      lastName: string;
      notYetCompetent: number;
      authorisationId: string | null;
      awaitingOral: boolean;
    }[] = [];

    for (const [key, entry] of perLearner) {
      const outcomes = [...entry.outcomes.values()];
      if (outcomes.includes("competent")) continue;

      const notYetCompetent = outcomes.filter(
        (outcome) => outcome === "not_yet_competent",
      ).length;
      if (notYetCompetent < ATTEMPTS_BEFORE_REVIEW) continue;

      const authorisation = byKey.get(key);

      // Reviewed and closed off: further learning or a withdrawal needs no
      // further prompting from this list.
      if (
        authorisation &&
        authorisation.outcome !== "oral_reassessment"
      ) {
        continue;
      }

      // The oral has been sat; it is now an ordinary marking job.
      if (authorisation?.submissionId) continue;

      held.push({
        assessmentId: entry.assessmentId,
        assessmentTitle: entry.assessmentTitle,
        userId: entry.userId,
        firstName: entry.firstName,
        lastName: entry.lastName,
        notYetCompetent,
        authorisationId: authorisation?.id ?? null,
        awaitingOral: Boolean(authorisation),
      });
    }

    return held.sort((a, b) => a.lastName.localeCompare(b.lastName));
  });
}

/**
 * The criteria this assessment tests, for the assessor conducting the oral.
 *
 * Taken from the questions on its papers, because that is where the tagging
 * lives — the oral attempt draws no items of its own, but it has to cover the
 * same ground, and an assessor working from memory covers what they remember.
 */
export async function criteriaForAssessment(
  session: AuthenticatedSession,
  assessmentId: string,
) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .selectDistinct({
        id: assessmentCriteria.id,
        code: assessmentCriteria.code,
        description: assessmentCriteria.description,
      })
      .from(assessmentPapers)
      .innerJoin(
        assessmentSections,
        eq(assessmentSections.paperId, assessmentPapers.id),
      )
      .innerJoin(
        assessmentItems,
        eq(assessmentItems.sectionId, assessmentSections.id),
      )
      .innerJoin(
        assessmentItemCriteria,
        eq(assessmentItemCriteria.itemId, assessmentItems.id),
      )
      .innerJoin(
        assessmentCriteria,
        eq(assessmentCriteria.id, assessmentItemCriteria.criterionId),
      )
      .where(eq(assessmentPapers.assessmentId, assessmentId));

    return rows.sort((a, b) => a.code.localeCompare(b.code));
  });
}
