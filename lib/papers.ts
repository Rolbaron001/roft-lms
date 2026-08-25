import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentItems,
  assessmentPapers,
  assessmentSections,
  assessmentSubmissions,
  assessments,
  courseSteps,
  itemResponses,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { assertStepOpen, SpineError } from "./spine";

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
        "A question a learner picks an answer to needs at least two options.",
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
        "A question a learner picks an answer to needs a correct answer recorded, or nothing can mark it.",
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
      );

    for (const section of sections) {
      const own = items.filter((item) => item.sectionId === section.id);

      if (own.length === 0) {
        problems.push(`"${section.title}" has no questions.`);
        continue;
      }

      const marks = own.reduce((sum, item) => sum + item.points, 0);
      if (section.markTotal !== null && section.markTotal !== marks) {
        problems.push(
          `"${section.title}" says it is worth ${section.markTotal} marks, but its questions add up to ${marks}.`,
        );
      }

      for (const item of own) {
        if (item.type === "long_answer" && !item.markingGuide) {
          problems.push(
            `"${item.stem.slice(0, 60)}…" is marked by a person but has no marking guidance.`,
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
  answer: {
    selectedOptionIds: string[] | null;
    answerText: string | null;
    answerNumber: string | null;
  };
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
};

const DEFAULT_DECLARATION =
  "This is my own work. I have not copied it from anyone else, I have not used " +
  "generative AI to produce it, and I have credited every source I drew on.";

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
 */
export async function startAttempt(
  session: AuthenticatedSession,
  assessmentId: string,
  options: { enrolmentId?: string | null; invigilatorId?: string | null } = {},
): Promise<Sitting> {
  // A gated assessment is refused here, not merely hidden on the page that
  // would have linked to it.
  await assertAssessmentStepOpen(session, assessmentId);

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
          "That assessment is still a draft, so it cannot be sat.",
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

      if (
        assessment.maxAttempts !== null &&
        attempts.length >= assessment.maxAttempts
      ) {
        throw new PaperError(
          `You have used all ${assessment.maxAttempts} attempts at this assessment. Speak to your facilitator.`,
          "no_attempts_left",
        );
      }

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

  return getSitting(session, submissionId);
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
              points: item.points,
              answer: {
                selectedOptionIds: answer?.selectedOptionIds ?? null,
                answerText: answer?.answerText ?? null,
                answerNumber: answer?.answerNumber ?? null,
              },
            };
          }),
      })),
    };
  });
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
        "Time is up for this assessment, so nothing further can be saved.",
        "closed",
      );
    }

    // An item may hold one kind of answer. Clearing the others means switching
    // from a typed answer to a chosen one does not leave both behind.
    const values = {
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
          "Confirm the declaration before handing in. It is what makes this your work on the record.",
        ],
        unanswered: 0,
      };
    }

    const declaration =
      assessment.declarationText?.trim() || DEFAULT_DECLARATION;

    const items = await tx
      .select({ id: assessmentItems.id })
      .from(assessmentItems)
      .where(
        submission.paperId
          ? inArray(
              assessmentItems.sectionId,
              (
                await tx
                  .select({ id: assessmentSections.id })
                  .from(assessmentSections)
                  .where(eq(assessmentSections.paperId, submission.paperId))
              ).map((section) => section.id),
            )
          : eq(assessmentItems.assessmentId, submission.assessmentId),
      );

    const answers = await tx
      .select({ itemId: itemResponses.itemId })
      .from(itemResponses)
      .where(eq(itemResponses.submissionId, input.submissionId));

    const answered = new Set(answers.map((row) => row.itemId));
    const unanswered = items.filter((item) => !answered.has(item.id)).length;

    // A summative decision is a person's judgement. A formative paper has no
    // decision to wait for, so handing it in finishes it.
    const awaitingAssessor = assessment.purpose === "summative";

    await tx
      .update(assessmentSubmissions)
      .set({
        status: awaitingAssessor ? "submitted" : "finalised",
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

    await tx
      .update(assessmentSubmissions)
      .set({
        status: assessment.purpose === "summative" ? "submitted" : "finalised",
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
