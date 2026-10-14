import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { DEFAULT_DECLARATION } from "./declaration";
import { ALREADY_COMPETENT_MESSAGE, alreadyCompetent } from "./already-competent";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentItems,
  assessmentPapers,
  assessmentSections,
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  captureJobs,
  courseSteps,
  evidenceArtifacts,
  feedbackAttachments,
  formativeFeedback,
  itemResponses,
  moderationRecords,
  sectionFeedback,
} from "@/db/schema";
import { autoMark, platformMarks } from "./auto-mark";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { assertStepOpen, SpineError } from "./spine";
// The rule lives beside the review it triggers, so there is one definition.
import { ATTEMPTS_BEFORE_REVIEW } from "./reassessment";

/**
 * Sitting a paper.
 *
 * A workbook or an assessment answered on screen rather than in a Word file
 * emailed back and forth. Four rules run through this file:
 *
 *   1. **The memorandum never reaches a learner.** Correct options, marking
 *      guidance and model answers are excluded by the query that builds the
 *      page, not hidden by the template that renders it. A template can be
 *      wrong; a column that was never selected cannot leak.
 *
 *   2. **Nothing is lost.** Answers save per question as they are typed, so a
 *      closed laptop or a dropped connection costs one answer rather than an
 *      afternoon.
 *
 *   3. **The declaration is a control, not a formality.** Submission is
 *      refused without it, and the exact wording agreed to is frozen into the
 *      submission — so a year later the record shows what was agreed and not
 *      merely that something was.
 *
 *   4. **The clock is real.** It runs from the moment the attempt started, on
 *      the server. A learner who leaves the page open does not gain time, and
 *      one who runs out has their work handed in rather than discarded.
 */

export class PaperError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "invalid"
      | "closed"
      | "no_attempts_left",
  ) {
    super(message);
    this.name = "PaperError";
  }
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export async function addPaper(
  session: AuthenticatedSession,
  input: {
    assessmentId: string;
    code: string;
    mode?: "written" | "oral";
  },
) {
  assertSessionCan(session, "assessment:author");

  const code = input.code.trim().toUpperCase();
  if (!code) throw new PaperError("A paper needs a code, such as V1.", "invalid");

  return withTenant(session.organisationId, async (tx) => {
    const existing = await tx
      .select({ id: assessmentPapers.id })
      .from(assessmentPapers)
      .where(eq(assessmentPapers.assessmentId, input.assessmentId));

    const [paper] = await tx
      .insert(assessmentPapers)
      .values({
        organisationId: session.organisationId,
        assessmentId: input.assessmentId,
        code,
        mode: input.mode ?? "written",
        sortOrder: existing.length,
      })
      .returning();

    return paper;
  });
}

export async function addSection(
  session: AuthenticatedSession,
  input: {
    paperId: string;
    title: string;
    instruction?: string;
    stimulus?: string;
    markTotal?: number;
  },
) {
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, async (tx) => {
    const existing = await tx
      .select({ id: assessmentSections.id })
      .from(assessmentSections)
      .where(eq(assessmentSections.paperId, input.paperId));

    const [section] = await tx
      .insert(assessmentSections)
      .values({
        organisationId: session.organisationId,
        paperId: input.paperId,
        title: input.title.trim(),
        instruction: input.instruction?.trim() || null,
        stimulus: input.stimulus?.trim() || null,
        markTotal: input.markTotal ?? null,
        sortOrder: existing.length,
      })
      .returning();

    return section;
  });
}

export async function addSectionItem(
  session: AuthenticatedSession,
  input: {
    sectionId: string;
    type:
      | "multiple_choice"
      | "multiple_response"
      | "true_false"
      | "short_answer"
      | "long_answer"
      | "numeric";
    stem: string;
    options?: string[];
    correctIndexes?: number[];
    markingGuide?: string;
    points?: number;
    criterionId?: string;
  },
) {
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, async (tx) => {
    const [section] = await tx
      .select({
        id: assessmentSections.id,
        paperId: assessmentSections.paperId,
      })
      .from(assessmentSections)
      .where(eq(assessmentSections.id, input.sectionId));

    if (!section) throw new PaperError("No such section.", "not_found");

    const [paper] = await tx
      .select({ assessmentId: assessmentPapers.assessmentId })
      .from(assessmentPapers)
      .where(eq(assessmentPapers.id, section.paperId));

    const selected =
      input.type === "multiple_choice" ||
      input.type === "multiple_response" ||
      input.type === "true_false";

    if (selected && (!input.options || input.options.length < 2)) {
      throw new PaperError(
        "A multiple-choice question needs at least two options.",
        "invalid",
      );
    }

    const options = (input.options ?? []).map((text) => ({
      id: randomUUID(),
      text,
    }));

    const correct = (input.correctIndexes ?? []).map((index) => {
      const option = options[index];
      if (!option) {
        throw new PaperError(
          `The memorandum names option ${index + 1}, but this question has ${options.length}.`,
          "invalid",
        );
      }
      return option.id;
    });

    if (selected && correct.length === 0) {
      throw new PaperError(
        "Record a correct answer for each multiple-choice question.",
        "invalid",
      );
    }

    const existing = await tx
      .select({ id: assessmentItems.id })
      .from(assessmentItems)
      .where(eq(assessmentItems.sectionId, input.sectionId));

    const [item] = await tx
      .insert(assessmentItems)
      .values({
        organisationId: session.organisationId,
        assessmentId: paper.assessmentId,
        sectionId: input.sectionId,
        type: input.type,
        stem: input.stem.trim(),
        options: selected ? options : null,
        correctOptionIds: selected ? correct : null,
        markingGuide: input.markingGuide?.trim() || null,
        points: input.points ?? 1,
        criterionId: input.criterionId ?? null,
        sortOrder: existing.length,
      })
      .returning();

    return item;
  });
}

/**
 * Checks a paper against itself, and refuses to publish one that does not add
 * up.
 *
 * A section whose printed total disagrees with its questions is the commonest
 * fault in a hand-built paper, and the one a learner notices at the worst
 * moment. Reported rather than corrected: only the author knows which of the
 * two numbers is right.
 */
export async function paperProblems(
  session: AuthenticatedSession,
  paperId: string,
): Promise<string[]> {
  return withTenant(session.organisationId, async (tx) => {
    const sections = await tx
      .select()
      .from(assessmentSections)
      .where(eq(assessmentSections.paperId, paperId))
      .orderBy(asc(assessmentSections.sortOrder));

    if (sections.length === 0) return ["This paper has no sections."];

    const problems: string[] = [];
    const items = await tx
      .select()
      .from(assessmentItems)
      .where(
        inArray(
          assessmentItems.sectionId,
          sections.map((section) => section.id),
        ),
      )
      .orderBy(asc(assessmentItems.sortOrder));

    /*
     * The number each question is printed with, where the paper was captured
     * from a document. Heidi, 5 October 2026: a problem "should say it's
     * question X or Y", or nobody can find it in the workbook. The capture
     * keeps the reading, numbers included, in the paper's order.
     */
    const [job] = await tx
      .select({ proposal: captureJobs.proposal })
      .from(captureJobs)
      .where(eq(captureJobs.paperId, paperId))
      .orderBy(desc(captureJobs.committedAt))
      .limit(1);
    const read = (job?.proposal ?? null) as { sections?: { items?: { number?: string }[] }[] } | null;
    const printed = (sectionIndex: number, itemIndex: number) => read?.sections?.[sectionIndex]?.items?.[itemIndex]?.number ?? String(itemIndex + 1);

    for (const [sectionIndex, section] of sections.entries()) {
      const own = items.filter((item) => item.sectionId === section.id);

      if (own.length === 0) {
        problems.push(`"${section.title}" has no questions.`);
        continue;
      }

      // Rounded, since half marks summed in floating point drift.
      const marks = Math.round(own.reduce((sum, item) => sum + item.points, 0) * 100) / 100;
      if (section.markTotal !== null && section.markTotal !== marks) {
        // Each question's marks, so the one that is wrong can be found
        // without counting the paper by hand.
        const each = own.slice(0, 12).map((item, index) => `${printed(sectionIndex, index)}: ${item.points}`).join(", ");
        problems.push(
          `"${section.title}" says it is worth ${section.markTotal} marks, but its questions add up to ${marks} (${each}${own.length > 12 ? ", …" : ""}).`,
        );
      }

      for (const [itemIndex, item] of own.entries()) {
        if (item.type === "long_answer" && !item.markingGuide) {
          problems.push(
            `Question ${printed(sectionIndex, itemIndex)} of "${section.title}" ("${item.stem.slice(0, 60)}…") is marked by a person, and the assessor guide gives no marking guidance for it.`,
          );
        }
      }
    }

    return problems;
  });
}

export async function publishPaper(
  session: AuthenticatedSession,
  paperId: string,
) {
  assertSessionCan(session, "assessment:author");

  const problems = await paperProblems(session, paperId);
  if (problems.length > 0) {
    return { ok: false as const, reasons: problems };
  }

  await withTenant(session.organisationId, async (tx) => {
    await tx
      .update(assessmentPapers)
      .set({ status: "published" })
      .where(eq(assessmentPapers.id, paperId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment.paper_published",
      entityType: "assessment_paper",
      entityId: paperId,
    });
  });

  return { ok: true as const, reasons: [] };
}

// ---------------------------------------------------------------------------
// Sitting it
// ---------------------------------------------------------------------------

export type LearnerItem = {
  id: string;
  type: string;
  stem: string;
  /** Options without any hint of which is correct. */
  options: { id: string; text: string }[] | null;
  points: number;
  /** The left column of a matching item; the answers are `options`. */
  matchPrompts: { id: string; text: string }[] | null;
  answer: {
    selectedOptionIds: string[] | null;
    answerText: string | null;
    answerNumber: string | null;
    matchedPairs: Record<string, string> | null;
  };
  /** Files the learner attached to this question. */
  files: { id: string; filename: string; sizeBytes: number }[];
  /**
   * The mark and comment, once the work has been returned to the learner.
   * Null until then, so nothing half-marked reaches them.
   */
  result: { awarded: number | null; comment: string | null; byPlatform: boolean } | null;
};

/** What comes back with the work once it is returned (job sheet D29). */
export type ReturnedWork = {
  comments: string | null;
  marksAwarded: number;
  marksAvailable: number;
  returnedAt: Date | null;
  sections: { title: string; comments: string }[];
  attachments: { id: string; filename: string; mimeType: string }[];
  /** For a summative, the assessor's decision. */
  outcome: string | null;
};

export type LearnerSection = {
  id: string;
  title: string;
  instruction: string | null;
  stimulus: string | null;
  markTotal: number | null;
  items: LearnerItem[];
};

export type Sitting = {
  submissionId: string;
  assessmentTitle: string;
  purpose: "formative" | "summative";
  attemptNumber: number;
  paperCode: string;
  status: string;
  startedAt: Date | null;
  /** Null when the assessment is untimed. */
  closesAt: Date | null;
  declarationText: string | null;
  sections: LearnerSection[];
  totalMarks: number;
  /** The assessment's own instructions, shown before the first question. */
  instructions: string | null;
  /** Null until the work is returned. */
  returned: ReturnedWork | null;
};


/**
 * Picks the paper for an attempt.
 *
 * `rotate` walks the papers in order so a re-sit is a different paper — the
 * whole reason two exist. It stops at the last one rather than wrapping,
 * because handing a learner V1 again on attempt three would quietly turn a
 * re-sit into a repeat.
 */
function paperForAttempt<T>(papers: T[], attemptNumber: number, policy: string): T {
  if (policy === "fixed") return papers[0];
  if (policy === "random") {
    return papers[Math.floor(Math.random() * papers.length)];
  }
  return papers[Math.min(attemptNumber - 1, papers.length - 1)];
}

/**
 * Opens an attempt, or returns the one already in progress.
 *
 * Deliberately idempotent: a learner refreshing the page, or coming back the
 * next morning, resumes rather than starting again and losing what they had.
 *
 * Once an attempt is handed in, opening the paper shows that attempt, with its
 * marks and feedback when they are returned. A new attempt starts only when
 * the learner asks for one (`fresh`). Until 14 October 2026 opening a handed-in
 * workbook started a blank attempt, so the learner never saw their answers or
 * the facilitator's feedback again.
 */
export async function startAttempt(
  session: AuthenticatedSession,
  assessmentId: string,
  options: { enrolmentId?: string | null; invigilatorId?: string | null; fresh?: boolean } = {},
): Promise<Sitting & { canStartAgain: boolean }> {
  // A gated assessment is refused here, not merely hidden on the page that
  // would have linked to it.
  await assertAssessmentStepOpen(session, assessmentId);

  let canStartAgain = false;
  const submissionId = await withTenant(
    session.organisationId,
    async (tx) => {
      const [assessment] = await tx
        .select()
        .from(assessments)
        .where(eq(assessments.id, assessmentId));

      if (!assessment) throw new PaperError("No such assessment.", "not_found");
      if (assessment.status !== "published") {
        throw new PaperError(
          "That assessment is a draft and cannot be sat.",
          "closed",
        );
      }

      const papers = await tx
        .select()
        .from(assessmentPapers)
        .where(
          and(
            eq(assessmentPapers.assessmentId, assessmentId),
            eq(assessmentPapers.status, "published"),
            eq(assessmentPapers.mode, "written"),
          ),
        )
        .orderBy(asc(assessmentPapers.sortOrder));

      if (papers.length === 0) {
        throw new PaperError(
          "That assessment has no published paper to sit.",
          "closed",
        );
      }

      const attempts = await tx
        .select()
        .from(assessmentSubmissions)
        .where(
          and(
            eq(assessmentSubmissions.assessmentId, assessmentId),
            eq(assessmentSubmissions.userId, session.userId),
          ),
        )
        .orderBy(desc(assessmentSubmissions.attemptNumber));

      const inProgress = attempts.find((a) => a.status === "draft");
      if (inProgress) return inProgress.id;

      // A handed-in attempt is shown rather than replaced, unless the learner
      // asked to start again. Whether they may is worked out here, by the same
      // rules that refuse a fresh attempt below.
      if (!options.fresh && attempts.length > 0) {
        const latest = attempts[0];
        const settled = latest.status === "finalised" || latest.status === "moderated";
        canStartAgain =
          settled && (await refusalOfNewAttempt(tx, assessment, attempts, session.userId)) === null;
        return latest.id;
      }

      const refusal = await refusalOfNewAttempt(tx, assessment, attempts, session.userId);
      if (refusal) throw refusal;

      const attemptNumber = attempts.length + 1;
      const paper = paperForAttempt(
        papers,
        attemptNumber,
        assessment.attemptPolicy,
      );

      const frozen = await freezePaper(tx, paper.id);

      const [created] = await tx
        .insert(assessmentSubmissions)
        .values({
          organisationId: session.organisationId,
          assessmentId,
          userId: session.userId,
          enrolmentId: options.enrolmentId ?? null,
          attemptNumber,
          status: "draft",
          paperId: paper.id,
          frozenPaper: frozen,
          startedAt: new Date(),
          invigilatorId: options.invigilatorId ?? null,
        })
        .returning({ id: assessmentSubmissions.id });

      await recordAudit(tx, {
        organisationId: session.organisationId,
        actorId: session.userId,
        action: "assessment.attempt_started",
        entityType: "assessment_submission",
        entityId: created.id,
        after: { assessmentId, attemptNumber, paper: paper.code },
      });

      return created.id;
    },
  );

  return { ...(await getSitting(session, submissionId)), canStartAgain };
}

/**
 * Why a new attempt may not start, or null when it may.
 *
 * One definition, used both to refuse a new attempt and to decide whether the
 * page offers one.
 */
async function refusalOfNewAttempt(
  tx: TenantDatabase,
  assessment: { id: string; purpose: "formative" | "summative"; maxAttempts: number | null },
  attempts: { id: string; status: string }[],
  userId: string,
): Promise<PaperError | null> {
  if (await alreadyCompetent(tx, assessment.id, userId)) {
    return new PaperError(ALREADY_COMPETENT_MESSAGE, "closed");
  }

  // The last one is still with the facilitator or assessor, undecided.
  if (attempts.some((attempt) => attempt.status === "submitted")) {
    return new PaperError("Your last attempt is still being marked.", "closed");
  }

  // Held, not failed.
  //
  // After two not-yet-competent results on a summative the learner does not
  // simply run out of attempts. A programme review is convened with their
  // employer, and only that review can open a third attempt — which is
  // conducted orally, by an assessor, not sat here.
  //
  // The distinction matters at the point it is read: "you have used all
  // your attempts" tells somebody their programme is over, and it is not.
  if (assessment.purpose === "summative" && attempts.length > 0) {
    const decisions = await tx
      .select({
        submissionId: assessmentDecisions.submissionId,
        outcome: assessmentDecisions.outcome,
      })
      .from(assessmentDecisions)
      .where(
        inArray(
          assessmentDecisions.submissionId,
          attempts.map((attempt) => attempt.id),
        ),
      );

    // The latest decision on each attempt: a referral back can produce a
    // second decision on one attempt, and only the surviving one counts.
    const latest = new Map<string, string>();
    for (const decision of decisions) {
      latest.set(decision.submissionId, decision.outcome);
    }

    const outcomes = [...latest.values()];
    const failures = outcomes.filter(
      (outcome) => outcome === "not_yet_competent",
    ).length;

    if (
      !outcomes.includes("competent") &&
      failures >= ATTEMPTS_BEFORE_REVIEW
    ) {
      return new PaperError(
        "This assessment is held while your progress is reviewed. Your facilitator arranges a discussion with your employer and any further attempt.",
        "no_attempts_left",
      );
    }
  }

  if (
    assessment.maxAttempts !== null &&
    attempts.length >= assessment.maxAttempts
  ) {
    return new PaperError(
      `You have used all ${assessment.maxAttempts} attempts at this assessment. Contact your facilitator.`,
      "no_attempts_left",
    );
  }

  return null;
}

/** The paper as presented, so an edit next month cannot change what was sat. */
async function freezePaper(tx: TenantDatabase, paperId: string) {
  const sections = await tx
    .select()
    .from(assessmentSections)
    .where(eq(assessmentSections.paperId, paperId))
    .orderBy(asc(assessmentSections.sortOrder));

  const items = await tx
    .select()
    .from(assessmentItems)
    .where(
      inArray(
        assessmentItems.sectionId,
        sections.map((section) => section.id),
      ),
    )
    .orderBy(asc(assessmentItems.sortOrder));

  return {
    frozenAt: new Date().toISOString(),
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      instruction: section.instruction,
      stimulus: section.stimulus,
      markTotal: section.markTotal,
      items: items
        .filter((item) => item.sectionId === section.id)
        .map((item) => ({
          id: item.id,
          type: item.type,
          stem: item.stem,
          options: item.options,
          matchPrompts: item.matchPrompts,
          points: item.points,
        })),
    })),
  };
}

/**
 * The paper as the learner sees it, and their answers so far.
 *
 * The memorandum is absent by construction: `correctOptionIds` and
 * `markingGuide` are never selected here, so no template mistake can put them
 * on a learner's screen.
 */
export async function getSitting(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<Sitting> {
  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, submissionId));

    if (!submission) throw new PaperError("No such attempt.", "not_found");
    if (submission.userId !== session.userId) {
      throw new PaperError("That attempt belongs to someone else.", "not_permitted");
    }

    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, submission.assessmentId));

    const [paper] = submission.paperId
      ? await tx
          .select()
          .from(assessmentPapers)
          .where(eq(assessmentPapers.id, submission.paperId))
      : [null];

    const sections = paper
      ? await tx
          .select()
          .from(assessmentSections)
          .where(eq(assessmentSections.paperId, paper.id))
          .orderBy(asc(assessmentSections.sortOrder))
      : [];

    const items =
      sections.length === 0
        ? []
        : await tx
            .select({
              id: assessmentItems.id,
              sectionId: assessmentItems.sectionId,
              type: assessmentItems.type,
              stem: assessmentItems.stem,
              options: assessmentItems.options,
              matchPrompts: assessmentItems.matchPrompts,
              points: assessmentItems.points,
              sortOrder: assessmentItems.sortOrder,
            })
            .from(assessmentItems)
            .where(
              inArray(
                assessmentItems.sectionId,
                sections.map((section) => section.id),
              ),
            )
            .orderBy(asc(assessmentItems.sortOrder));

    const answers = await tx
      .select()
      .from(itemResponses)
      .where(eq(itemResponses.submissionId, submissionId));

    const answerByItem = new Map(answers.map((row) => [row.itemId, row]));

    const files = await tx
      .select({
        id: evidenceArtifacts.id,
        itemId: evidenceArtifacts.itemId,
        filename: evidenceArtifacts.filename,
        sizeBytes: evidenceArtifacts.sizeBytes,
      })
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.submissionId, submissionId))
      .orderBy(asc(evidenceArtifacts.uploadedAt));

    const returned = await returnedWork(tx, submission, assessment.purpose);

    const closesAt =
      submission.startedAt && assessment.timeLimitMinutes
        ? new Date(
            submission.startedAt.getTime() +
              assessment.timeLimitMinutes * 60_000,
          )
        : null;

    return {
      submissionId,
      assessmentTitle: assessment.title,
      purpose: assessment.purpose,
      attemptNumber: submission.attemptNumber,
      paperCode: paper?.code ?? "",
      status: submission.status,
      startedAt: submission.startedAt,
      closesAt,
      declarationText:
        submission.declarationText ??
        assessment.declarationText ??
        DEFAULT_DECLARATION,
      totalMarks: items.reduce((sum, item) => sum + item.points, 0),
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        instruction: section.instruction,
        stimulus: section.stimulus,
        markTotal: section.markTotal,
        items: items
          .filter((item) => item.sectionId === section.id)
          .map((item) => {
            const answer = answerByItem.get(item.id);
            return {
              id: item.id,
              type: item.type,
              stem: item.stem,
              options: item.options,
              matchPrompts: item.matchPrompts ?? null,
              points: item.points,
              answer: {
                selectedOptionIds: answer?.selectedOptionIds ?? null,
                answerText: answer?.answerText ?? null,
                answerNumber: answer?.answerNumber ?? null,
                matchedPairs: answer?.matchedPairs ?? null,
              },
              files: files
                .filter((file) => file.itemId === item.id)
                .map(({ id, filename, sizeBytes }) => ({ id, filename, sizeBytes })),
              result: returned
                ? {
                    awarded:
                      answer?.awardedMarks !== null && answer?.awardedMarks !== undefined
                        ? Number(answer.awardedMarks)
                        : null,
                    comment: answer?.assessorComment ?? null,
                    byPlatform: answer?.autoMarks != null && answer?.markedById == null,
                  }
                : null,
            };
          }),
      })),
      instructions: assessment.instructions ?? null,
      returned,
    };
  });
}

/**
 * The feedback that comes back with the work, or null while it is still with
 * the facilitator or assessor.
 *
 * A workbook is returned when the facilitator returns it. A summative is
 * returned when the decision is settled: finalised, or confirmed by a
 * moderator. Nothing half-marked reaches the learner.
 */
async function returnedWork(
  tx: TenantDatabase,
  submission: { id: string; status: string },
  purpose: "formative" | "summative",
): Promise<ReturnedWork | null> {
  if (submission.status !== "finalised" && submission.status !== "moderated") return null;

  const [feedback] = await tx
    .select()
    .from(formativeFeedback)
    .where(eq(formativeFeedback.submissionId, submission.id));

  let outcome: string | null = null;
  if (purpose === "summative") {
    const decisions = await tx
      .select({
        outcome: assessmentDecisions.outcome,
        comments: assessmentDecisions.comments,
        moderationOutcome: moderationRecords.outcome,
        revisedOutcome: moderationRecords.revisedOutcome,
      })
      .from(assessmentDecisions)
      .leftJoin(moderationRecords, eq(moderationRecords.decisionId, assessmentDecisions.id))
      .where(eq(assessmentDecisions.submissionId, submission.id))
      .orderBy(desc(assessmentDecisions.signedAt))
      .limit(1);
    const latest = decisions[0];
    if (!latest) return null;
    outcome =
      latest.moderationOutcome === "overridden" && latest.revisedOutcome
        ? latest.revisedOutcome
        : latest.outcome;
  } else if (!feedback) {
    return null;
  }

  const sections = await tx
    .select({ title: assessmentSections.title, comments: sectionFeedback.comments })
    .from(sectionFeedback)
    .innerJoin(assessmentSections, eq(assessmentSections.id, sectionFeedback.sectionId))
    .where(eq(sectionFeedback.submissionId, submission.id))
    .orderBy(asc(assessmentSections.sortOrder));

  const attachments = await tx
    .select({
      id: feedbackAttachments.id,
      filename: feedbackAttachments.filename,
      mimeType: feedbackAttachments.mimeType,
    })
    .from(feedbackAttachments)
    .where(eq(feedbackAttachments.submissionId, submission.id))
    .orderBy(asc(feedbackAttachments.uploadedAt));

  const marks = await tx
    .select({ awarded: itemResponses.awardedMarks })
    .from(itemResponses)
    .where(eq(itemResponses.submissionId, submission.id));

  return {
    comments: feedback?.comments ?? null,
    marksAwarded: feedback
      ? Number(feedback.marksAwarded ?? 0)
      : marks.reduce((sum, row) => sum + Number(row.awarded ?? 0), 0),
    marksAvailable: Number(feedback?.marksAvailable ?? 0),
    returnedAt: feedback?.returnedAt ?? null,
    sections,
    attachments,
    outcome,
  };
}

/**
 * Saves one answer.
 *
 * Refuses once the attempt is handed in or the clock has run out, so a browser
 * left open overnight cannot post an answer into a finished paper.
 */
export async function saveAnswer(
  session: AuthenticatedSession,
  input: {
    submissionId: string;
    itemId: string;
    selectedOptionIds?: string[];
    answerText?: string;
    answerNumber?: number;
    matchedPairs?: Record<string, string>;
  },
): Promise<{ savedAt: Date }> {
  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, input.submissionId));

    if (!submission) throw new PaperError("No such attempt.", "not_found");
    if (submission.userId !== session.userId) {
      throw new PaperError("That attempt belongs to someone else.", "not_permitted");
    }
    if (submission.status !== "draft") {
      throw new PaperError(
        "This has already been handed in, so it cannot be changed.",
        "closed",
      );
    }

    const [assessment] = await tx
      .select({ timeLimitMinutes: assessments.timeLimitMinutes })
      .from(assessments)
      .where(eq(assessments.id, submission.assessmentId));

    if (
      assessment.timeLimitMinutes &&
      submission.startedAt &&
      Date.now() >
        submission.startedAt.getTime() + assessment.timeLimitMinutes * 60_000
    ) {
      throw new PaperError(
        "Time is up for this assessment. Nothing more can be saved.",
        "closed",
      );
    }

    // An item may hold one kind of answer. Clearing the others means switching
    // from a typed answer to a chosen one does not leave both behind. True or
    // false with a justification is the exception: it holds a choice and the
    // reason for it, so the form sends both together.
    const pairs = Object.fromEntries(
      Object.entries(input.matchedPairs ?? {}).filter(([, option]) => option !== ""),
    );
    const values = {
      matchedPairs: Object.keys(pairs).length > 0 ? pairs : null,
      selectedOptionIds: input.selectedOptionIds ?? null,
      answerText:
        input.answerText !== undefined && input.answerText.trim() !== ""
          ? input.answerText
          : null,
      answerNumber:
        input.answerNumber !== undefined ? String(input.answerNumber) : null,
      updatedAt: new Date(),
    };

    await tx
      .insert(itemResponses)
      .values({
        organisationId: session.organisationId,
        submissionId: input.submissionId,
        itemId: input.itemId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [itemResponses.submissionId, itemResponses.itemId],
        set: values,
      });

    return { savedAt: values.updatedAt };
  });
}

export type SubmitResult = {
  ok: boolean;
  reasons: string[];
  unanswered: number;
};

/**
 * Hands a paper in.
 *
 * Refused without the declaration, because that is the whole point of asking
 * for one. Unanswered questions do not refuse — a learner is entitled to leave
 * a question blank — but the count is returned so the interface can ask
 * whether they meant to.
 */
export async function submitAttempt(
  session: AuthenticatedSession,
  input: {
    submissionId: string;
    declarationAccepted: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
): Promise<SubmitResult> {
  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, input.submissionId));

    if (!submission) throw new PaperError("No such attempt.", "not_found");
    if (submission.userId !== session.userId) {
      throw new PaperError("That attempt belongs to someone else.", "not_permitted");
    }
    if (submission.status !== "draft") {
      return { ok: false, reasons: ["This has already been handed in."], unanswered: 0 };
    }

    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, submission.assessmentId));

    if (!input.declarationAccepted) {
      return {
        ok: false,
        reasons: [
          "Confirm the declaration to hand in.",
        ],
        unanswered: 0,
      };
    }

    const declaration =
      assessment.declarationText?.trim() || DEFAULT_DECLARATION;

    const { unanswered } = await markOnHandIn(tx, session.organisationId, submission);

    // A summative waits for an assessor's decision, and a workbook for the
    // facilitator to check the platform's marks, mark the rest and return it.
    // Until 14 October 2026 a workbook was finished the moment it was handed
    // in, so it reached nobody's list and the learner never had it back.
    await tx
      .update(assessmentSubmissions)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        submittedIp: input.ipAddress ?? null,
        submittedUserAgent: input.userAgent ?? null,
        declarationText: declaration,
        declarationAcceptedAt: new Date(),
      })
      .where(eq(assessmentSubmissions.id, input.submissionId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment.submitted",
      entityType: "assessment_submission",
      entityId: input.submissionId,
      after: {
        assessmentId: submission.assessmentId,
        attemptNumber: submission.attemptNumber,
        unanswered,
        declaration,
      },
      ipAddress: input.ipAddress,
    });

    return { ok: true, reasons: [], unanswered };
  });
}

/**
 * Hands in an attempt whose time has run out, keeping whatever was saved.
 *
 * Called when a learner comes back to a page whose clock expired while they
 * were away. Discarding the work instead would punish a dropped connection,
 * which is not what the time limit is for.
 */
export async function closeExpiredAttempt(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<boolean> {
  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, submissionId));

    if (!submission || submission.status !== "draft") return false;
    if (submission.userId !== session.userId) return false;

    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, submission.assessmentId));

    if (!assessment.timeLimitMinutes || !submission.startedAt) return false;

    const closesAt =
      submission.startedAt.getTime() + assessment.timeLimitMinutes * 60_000;
    if (Date.now() <= closesAt) return false;

    await markOnHandIn(tx, session.organisationId, submission);

    await tx
      .update(assessmentSubmissions)
      .set({
        // To a person, as a paper handed in on time is: see submitAttempt.
        status: "submitted",
        submittedAt: new Date(closesAt),
        declarationText:
          assessment.declarationText?.trim() || DEFAULT_DECLARATION,
        // Time ran out rather than the learner attesting, and the record says
        // so plainly: the wording stands, nobody accepted it, and the flag
        // makes that a fact an assessor reads rather than one they infer.
        declarationAcceptedAt: null,
        closedOnTime: true,
      })
      .where(eq(assessmentSubmissions.id, submissionId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment.closed_on_time",
      entityType: "assessment_submission",
      entityId: submissionId,
      after: { closedAt: new Date(closesAt).toISOString() },
    });

    return true;
  });
}

/**
 * Marks what the platform can mark, as a paper is handed in.
 *
 * Each selected-response and matching question gets the platform's mark in
 * `auto_marks` and, as the starting figure, in `awarded_marks` with no marker,
 * which is how the marking screen tells the platform's mark from a person's.
 * An assessor who changes it is recorded as having done so, with the platform's
 * figure kept beside theirs. Written answers, files and true or false with a
 * justification are left for a person.
 */
async function markOnHandIn(
  tx: TenantDatabase,
  organisationId: string,
  submission: { id: string; paperId: string | null; assessmentId: string },
): Promise<{ unanswered: number }> {
  const sectionIds = submission.paperId
    ? (
        await tx
          .select({ id: assessmentSections.id })
          .from(assessmentSections)
          .where(eq(assessmentSections.paperId, submission.paperId))
      ).map((section) => section.id)
    : [];

  const items = await tx
    .select({
      id: assessmentItems.id,
      type: assessmentItems.type,
      points: assessmentItems.points,
      correctOptionIds: assessmentItems.correctOptionIds,
      correctMatches: assessmentItems.correctMatches,
    })
    .from(assessmentItems)
    .where(
      sectionIds.length > 0
        ? inArray(assessmentItems.sectionId, sectionIds)
        : eq(assessmentItems.assessmentId, submission.assessmentId),
    );

  const answers = await tx
    .select()
    .from(itemResponses)
    .where(eq(itemResponses.submissionId, submission.id));
  const answerByItem = new Map(answers.map((row) => [row.itemId, row]));

  const files = await tx
    .select({ itemId: evidenceArtifacts.itemId })
    .from(evidenceArtifacts)
    .where(eq(evidenceArtifacts.submissionId, submission.id));
  const withFiles = new Set(files.map((file) => file.itemId));

  let unanswered = 0;
  for (const item of items) {
    const answer = answerByItem.get(item.id);
    if (!answer && !withFiles.has(item.id)) unanswered += 1;

    const marks = autoMark(item, answer ?? undefined);
    if (marks === null) continue;

    const values = {
      autoMarks: marks.toFixed(2),
      awardedMarks: marks.toFixed(2),
      markedById: null,
      markedAt: new Date(),
      updatedAt: new Date(),
    };
    await tx
      .insert(itemResponses)
      .values({ organisationId, submissionId: submission.id, itemId: item.id, ...values })
      .onConflictDoUpdate({
        target: [itemResponses.submissionId, itemResponses.itemId],
        set: values,
      });
  }

  return { unanswered };
}

/** Refuses when the assessment sits on a spine and its step is not open. */
async function assertAssessmentStepOpen(
  session: AuthenticatedSession,
  assessmentId: string,
): Promise<void> {
  const stepId = await withTenant(session.organisationId, async (tx) => {
    const [step] = await tx
      .select({ id: courseSteps.id })
      .from(courseSteps)
      .where(eq(courseSteps.assessmentId, assessmentId));
    return step?.id ?? null;
  });

  if (!stepId) return;

  try {
    await assertStepOpen(session, stepId);
  } catch (error) {
    if (error instanceof SpineError && error.code === "locked") {
      throw new PaperError(error.message, "closed");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Seeing it before a learner does
// ---------------------------------------------------------------------------

/**
 * A paper as the learner will meet it, for the person who wrote it.
 *
 * Roland, 20 September: "Workbooks and assessments are supposed to be 'Built
 * into' the LMS ... screens with textboxes that a user types into, completes
 * checkboxes, etc. Is this working? How do I see it (outside of being a
 * learner)?"
 *
 * It was working and there was no way to look at it. `/learn/[id]/paper/...`
 * needs an enrolment, and opening it starts a real attempt against a real
 * submission - so the only way to see a paper was to become a learner on it
 * and begin sitting it, which is both wrong and unrepeatable.
 *
 * This reads the same paper into the same shape and writes nothing. No
 * submission, no attempt, no clock, no responses. Every answer comes back
 * empty, and the page that renders it disables the controls, so there is
 * nothing to save even by accident.
 *
 * What it adds, because the reader is the author rather than the candidate, is
 * `answers`: which option is correct and what the marking guide says. That is
 * the half `LearnerItem` deliberately withholds, and the half somebody
 * checking a captured workbook most needs to see - a parser that got question
 * three's correct answer wrong is invisible until a learner appeals.
 */
export type PreviewItem = LearnerItem & {
  /** Option ids the memorandum marks correct, where the engine marks it. */
  correctOptionIds: string[] | null;
  /** What an assessor is told to look for, where a person marks it. */
  markingGuide: string | null;
  /** Whether the platform can mark this one at all. */
  markedBy: "app" | "assessor";
};

export type PaperPreview = {
  paperId: string;
  paperCode: string;
  mode: string;
  status: string;
  assessmentId: string;
  assessmentTitle: string;
  purpose: "formative" | "summative";
  timeLimitMinutes: number | null;
  declarationText: string;
  sections: (Omit<LearnerSection, "items"> & { items: PreviewItem[] })[];
  totalMarks: number;
};

export async function previewPaper(
  session: AuthenticatedSession,
  paperId: string,
): Promise<PaperPreview> {
  // The author's permission, not the learner's. Nothing here is a delivery
  // route: it reads a paper for the people who build and moderate them.
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, async (tx) => {
    const [paper] = await tx
      .select()
      .from(assessmentPapers)
      .where(eq(assessmentPapers.id, paperId));

    if (!paper) throw new PaperError("No such paper.", "not_found");

    const [assessment] = await tx
      .select()
      .from(assessments)
      .where(eq(assessments.id, paper.assessmentId));

    if (!assessment) throw new PaperError("No such assessment.", "not_found");

    const sections = await tx
      .select()
      .from(assessmentSections)
      .where(eq(assessmentSections.paperId, paper.id))
      .orderBy(asc(assessmentSections.sortOrder));

    const items =
      sections.length === 0
        ? []
        : await tx
            .select()
            .from(assessmentItems)
            .where(
              inArray(
                assessmentItems.sectionId,
                sections.map((section) => section.id),
              ),
            )
            .orderBy(asc(assessmentItems.sortOrder));

    let totalMarks = 0;

    const built = sections.map((section) => {
      const own = items.filter((item) => item.sectionId === section.id);

      return {
        id: section.id,
        title: section.title,
        instruction: section.instruction,
        stimulus: section.stimulus,
        markTotal: section.markTotal,
        items: own.map((item) => {
          totalMarks += item.points;

          /*
           * Only an item with recorded correct options can be marked by the
           * engine. Everything else is a person's judgement, including a
           * true/false that asks for a justification - the verdict is
           * checkable and the reasoning is not, and the marks are for the
           * reasoning.
           */
          const markedBy = platformMarks(item) ? ("app" as const) : ("assessor" as const);

          return {
            id: item.id,
            type: item.type,
            stem: item.stem,
            options: item.options ?? null,
            matchPrompts: item.matchPrompts ?? null,
            points: item.points,
            // Empty, always. A preview has nothing to resume and nothing to
            // save; the form it feeds is disabled throughout.
            answer: {
              selectedOptionIds: null,
              answerText: null,
              answerNumber: null,
              matchedPairs: null,
            },
            files: [],
            result: null,
            correctOptionIds: item.correctOptionIds ?? null,
            markingGuide: item.markingGuide,
            markedBy,
          };
        }),
      };
    });

    return {
      paperId: paper.id,
      paperCode: paper.code,
      mode: paper.mode,
      status: paper.status,
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      purpose: assessment.purpose as "formative" | "summative",
      timeLimitMinutes: assessment.timeLimitMinutes,
      declarationText: assessment.declarationText ?? DEFAULT_DECLARATION,
      sections: built,
      totalMarks,
    };
  });
}
