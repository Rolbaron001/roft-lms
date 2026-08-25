import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  assessmentItemCriteria,
  assessmentItems,
  assessmentSections,
  assessmentSubmissions,
  assessments,
  formativeFeedback,
  itemResponses,
  rubricDescriptors,
  rubricDimensions,
  rubricLevels,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Marking a paper, and what marking it means.
 *
 * This is the file where the difference between a quiz engine and an
 * occupational LMS lives, and it turns on one rule:
 *
 *   **Only a summative decision may reach the criterion ledger.**
 *
 * A workbook is developmental. It is marked, it earns marks, it produces
 * feedback naming the criteria a learner should go back to — and it never
 * writes competence. If developmental work could, a learner would accumulate
 * their way to EISA eligibility on practice exercises without ever sitting a
 * summative, and readiness would report them ready.
 *
 * The rule is enforced in two ways rather than one. `returnFeedback` writes to
 * a table readiness does not read, and `proposeCriterionOutcomes` refuses
 * outright on a formative assessment rather than returning an empty list — a
 * refusal is noticed, an empty list is not.
 */

export class MarkingError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "not_permitted" | "invalid" | "refused",
  ) {
    super(message);
    this.name = "MarkingError";
  }
}

// ---------------------------------------------------------------------------
// Marking one answer
// ---------------------------------------------------------------------------

export type MarkItemInput = {
  submissionId: string;
  itemId: string;
  /** Chosen level per dimension. Marks are derived from these when given. */
  rubricLevels?: Record<string, string>;
  /** An explicit mark, which overrides whatever the rubric suggests. */
  marks?: number;
  comment?: string;
};

/**
 * Records an assessor's mark for one answer.
 *
 * Where the item carries a rubric and the assessor has chosen a level for each
 * dimension, the mark is derived from the midpoints of those bands weighted by
 * dimension — which is what makes two assessors reach the same number. They may
 * still type a mark instead, and that wins, because a rubric is an instrument
 * for judgement and not a replacement for it.
 */
export async function markItem(
  session: AuthenticatedSession,
  input: MarkItemInput,
) {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, input.submissionId));

    if (!submission) throw new MarkingError("No such attempt.", "not_found");

    if (submission.userId === session.userId) {
      throw new MarkingError(
        "You cannot mark your own work.",
        "not_permitted",
      );
    }

    if (submission.status === "draft") {
      throw new MarkingError(
        "That has not been handed in yet, so there is nothing to mark.",
        "invalid",
      );
    }

    const [item] = await tx
      .select()
      .from(assessmentItems)
      .where(eq(assessmentItems.id, input.itemId));

    if (!item) throw new MarkingError("No such question.", "not_found");

    let marks = input.marks;

    if (marks === undefined && input.rubricLevels && item.rubricId) {
      marks = await marksFromRubric(
        tx,
        item.rubricId,
        input.rubricLevels,
        item.points,
      );
    }

    if (marks === undefined) {
      throw new MarkingError(
        "Give a mark, or choose a level for each part of the rubric.",
        "invalid",
      );
    }

    if (marks < 0 || marks > item.points) {
      throw new MarkingError(
        `That question is worth ${item.points} marks, so ${marks} is not a mark it can be given.`,
        "invalid",
      );
    }

    const values = {
      awardedMarks: marks.toFixed(2),
      rubricLevels: input.rubricLevels ?? null,
      assessorComment: input.comment?.trim() || null,
      markedById: session.userId,
      markedAt: new Date(),
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

    return { marks };
  });
}

/**
 * Turns chosen rubric levels into a mark.
 *
 * The midpoint of each band, weighted by dimension, rounded to the nearest
 * half mark — which is the granularity the example guides actually use
 * ("6.0 - 7.5 Marks").
 */
async function marksFromRubric(
  tx: TenantDatabase,
  rubricId: string,
  chosen: Record<string, string>,
  points: number,
): Promise<number> {
  const dimensions = await tx
    .select()
    .from(rubricDimensions)
    .where(eq(rubricDimensions.rubricId, rubricId))
    .orderBy(asc(rubricDimensions.sortOrder));

  const levels = await tx
    .select()
    .from(rubricLevels)
    .where(eq(rubricLevels.rubricId, rubricId));

  const levelById = new Map(levels.map((level) => [level.id, level]));

  const missing = dimensions.filter((dimension) => !chosen[dimension.id]);
  if (missing.length > 0) {
    throw new MarkingError(
      `Choose a level for ${missing.map((d) => `"${d.title}"`).join(" and ")} before this can be marked.`,
      "invalid",
    );
  }

  let weighted = 0;
  let totalWeight = 0;

  for (const dimension of dimensions) {
    const level = levelById.get(chosen[dimension.id]);
    if (!level) {
      throw new MarkingError(
        `"${dimension.title}" was given a level that does not belong to this rubric.`,
        "invalid",
      );
    }
    const midpoint = (level.minPercent + level.maxPercent) / 2;
    weighted += midpoint * dimension.weight;
    totalWeight += dimension.weight;
  }

  const percentage = totalWeight === 0 ? 0 : weighted / totalWeight;
  return Math.round((percentage / 100) * points * 2) / 2;
}

// ---------------------------------------------------------------------------
// What a marked paper adds up to
// ---------------------------------------------------------------------------

export type MarkedItem = {
  itemId: string;
  stem: string;
  points: number;
  awarded: number | null;
  comment: string | null;
  criterionIds: string[];

  /** What the learner actually wrote or chose. */
  answerText: string | null;
  selectedOptionIds: string[] | null;
  options: { id: string; text: string }[] | null;

  /**
   * The memorandum. Present here and nowhere a learner can reach: this whole
   * type is built behind `assessment:assess`.
   */
  markingGuide: string | null;
  correctOptionIds: string[] | null;
  rubricId: string | null;
  chosenLevels: Record<string, string> | null;
};

export type MarkedPaper = {
  submissionId: string;
  purpose: "formative" | "summative";
  assessmentTitle: string;
  learnerId: string;
  items: MarkedItem[];
  marksAwarded: number;
  marksAvailable: number;
  percentage: number;
  passMark: number;
  /** Every question has a mark. Until then nothing may be decided. */
  fullyMarked: boolean;
};

export async function getMarkedPaper(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<MarkedPaper> {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, (tx) =>
    readMarkedPaper(tx, submissionId),
  );
}

async function readMarkedPaper(
  tx: TenantDatabase,
  submissionId: string,
): Promise<MarkedPaper> {
  const [submission] = await tx
    .select()
    .from(assessmentSubmissions)
    .where(eq(assessmentSubmissions.id, submissionId));

  if (!submission) throw new MarkingError("No such attempt.", "not_found");

  const [assessment] = await tx
    .select()
    .from(assessments)
    .where(eq(assessments.id, submission.assessmentId));

  const sectionIds = submission.paperId
    ? (
        await tx
          .select({ id: assessmentSections.id })
          .from(assessmentSections)
          .where(eq(assessmentSections.paperId, submission.paperId))
      ).map((section) => section.id)
    : [];

  const items = await tx
    .select()
    .from(assessmentItems)
    .where(
      sectionIds.length > 0
        ? inArray(assessmentItems.sectionId, sectionIds)
        : eq(assessmentItems.assessmentId, submission.assessmentId),
    )
    .orderBy(asc(assessmentItems.sortOrder));

  const responses = await tx
    .select()
    .from(itemResponses)
    .where(eq(itemResponses.submissionId, submissionId));

  const byItem = new Map(responses.map((row) => [row.itemId, row]));

  const links =
    items.length === 0
      ? []
      : await tx
          .select()
          .from(assessmentItemCriteria)
          .where(
            inArray(
              assessmentItemCriteria.itemId,
              items.map((item) => item.id),
            ),
          );

  const marked: MarkedItem[] = items.map((item) => {
    const response = byItem.get(item.id);
    const linked = links
      .filter((link) => link.itemId === item.id)
      .map((link) => link.criterionId);

    return {
      itemId: item.id,
      stem: item.stem,
      points: item.points,
      awarded:
        response?.awardedMarks !== null && response?.awardedMarks !== undefined
          ? Number(response.awardedMarks)
          : null,
      comment: response?.assessorComment ?? null,
      answerText: response?.answerText ?? null,
      selectedOptionIds: response?.selectedOptionIds ?? null,
      options: item.options ?? null,
      markingGuide: item.markingGuide,
      correctOptionIds: item.correctOptionIds ?? null,
      rubricId: item.rubricId,
      chosenLevels: response?.rubricLevels ?? null,
      // The old single column is read as a fallback so items tagged before the
      // join table existed keep their criterion.
      criterionIds:
        linked.length > 0 ? linked : item.criterionId ? [item.criterionId] : [],
    };
  });

  const marksAvailable = marked.reduce((sum, item) => sum + item.points, 0);
  const marksAwarded = marked.reduce((sum, item) => sum + (item.awarded ?? 0), 0);

  return {
    submissionId,
    purpose: assessment.purpose,
    assessmentTitle: assessment.title,
    learnerId: submission.userId,
    items: marked,
    marksAwarded,
    marksAvailable,
    percentage:
      marksAvailable === 0 ? 0 : (marksAwarded / marksAvailable) * 100,
    passMark: assessment.passMark,
    fullyMarked: marked.every((item) => item.awarded !== null),
  };
}

// ---------------------------------------------------------------------------
// The proposal
// ---------------------------------------------------------------------------

export type CriterionProposal = {
  criterionId: string;
  code: string;
  description: string;
  outcome: "competent" | "not_yet_competent";
  /** The questions that evidence it, and how they were marked. */
  evidence: { stem: string; awarded: number; points: number }[];
};

/**
 * What the marks imply about each criterion, for an assessor to confirm.
 *
 * A proposal is not a decision. It is pre-filled so the assessor confirms
 * rather than retypes, and whatever they change is recorded as their judgement
 * — which is what the regulation actually requires and what an audit reads.
 *
 * A criterion is proposed competent when every question evidencing it reached
 * the pass mark. Not the average: a learner who wrote one excellent answer and
 * one empty one has not demonstrated the criterion, and averaging hides that.
 */
export async function proposeCriterionOutcomes(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<CriterionProposal[]> {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, async (tx) => {
    const paper = await readMarkedPaper(tx, submissionId);

    // The wall. A formative paper has no route to the criterion ledger, and
    // saying so out loud beats returning nothing and letting a caller conclude
    // the paper simply evidenced no criteria.
    if (paper.purpose !== "summative") {
      throw new MarkingError(
        "This is a workbook. It is developmental, so it produces feedback rather than a competence decision, and nothing it contains reaches the criterion ledger.",
        "refused",
      );
    }

    const criterionIds = [
      ...new Set(paper.items.flatMap((item) => item.criterionIds)),
    ];
    if (criterionIds.length === 0) return [];

    const criteria = await tx
      .select()
      .from(assessmentCriteria)
      .where(inArray(assessmentCriteria.id, criterionIds));

    return criteria.map((criterion) => {
      const evidencing = paper.items.filter((item) =>
        item.criterionIds.includes(criterion.id),
      );

      const allPassed = evidencing.every(
        (item) =>
          item.awarded !== null &&
          item.points > 0 &&
          (item.awarded / item.points) * 100 >= paper.passMark,
      );

      return {
        criterionId: criterion.id,
        code: criterion.code,
        description: criterion.description,
        outcome: allPassed
          ? ("competent" as const)
          : ("not_yet_competent" as const),
        evidence: evidencing.map((item) => ({
          stem: item.stem,
          awarded: item.awarded ?? 0,
          points: item.points,
        })),
      };
    });
  });
}

// ---------------------------------------------------------------------------
// Returning a workbook
// ---------------------------------------------------------------------------

/**
 * Returns a marked workbook to the learner.
 *
 * Refuses on a summative, which needs an assessor's decision rather than a
 * facilitator's feedback. Writes to a table readiness does not read, so no
 * amount of workbook feedback can move a learner towards eligibility.
 */
export async function returnFeedback(
  session: AuthenticatedSession,
  input: {
    submissionId: string;
    comments: string;
    criteriaOfConcern?: string[];
  },
) {
  assertSessionCan(session, "assessment:assess");

  const comments = input.comments.trim();
  if (comments.length < 10) {
    throw new MarkingError(
      "Say something the learner can use. Returning an empty comment looks, on the record, exactly like feedback that was given.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const paper = await readMarkedPaper(tx, input.submissionId);

    if (paper.purpose === "summative") {
      throw new MarkingError(
        "A summative assessment needs an assessor's decision, not feedback. Record the decision instead.",
        "refused",
      );
    }

    if (paper.learnerId === session.userId) {
      throw new MarkingError("You cannot mark your own work.", "not_permitted");
    }

    const [returned] = await tx
      .insert(formativeFeedback)
      .values({
        organisationId: session.organisationId,
        submissionId: input.submissionId,
        facilitatorId: session.userId,
        comments,
        criteriaOfConcern: input.criteriaOfConcern ?? null,
        marksAwarded: paper.marksAwarded.toFixed(2),
        marksAvailable: paper.marksAvailable.toFixed(2),
      })
      .onConflictDoUpdate({
        target: formativeFeedback.submissionId,
        set: {
          comments,
          criteriaOfConcern: input.criteriaOfConcern ?? null,
          marksAwarded: paper.marksAwarded.toFixed(2),
          marksAvailable: paper.marksAvailable.toFixed(2),
          facilitatorId: session.userId,
          returnedAt: new Date(),
        },
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment.feedback_returned",
      entityType: "assessment_submission",
      entityId: input.submissionId,
      after: {
        marks: `${paper.marksAwarded} of ${paper.marksAvailable}`,
        criteriaOfConcern: input.criteriaOfConcern ?? [],
      },
    });

    return returned;
  });
}

/** What a learner sees when their workbook comes back. */
export async function getFeedback(
  session: AuthenticatedSession,
  submissionId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [submission] = await tx
      .select({ userId: assessmentSubmissions.userId })
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, submissionId));

    if (!submission) throw new MarkingError("No such attempt.", "not_found");
    if (
      submission.userId !== session.userId &&
      !session.permissions.includes("assessment:assess")
    ) {
      throw new MarkingError("That belongs to someone else.", "not_permitted");
    }

    const [feedback] = await tx
      .select()
      .from(formativeFeedback)
      .where(eq(formativeFeedback.submissionId, submissionId));

    if (!feedback) return null;

    const concerns = feedback.criteriaOfConcern ?? [];
    const criteria =
      concerns.length === 0
        ? []
        : await tx
            .select({
              code: assessmentCriteria.code,
              description: assessmentCriteria.description,
            })
            .from(assessmentCriteria)
            .where(inArray(assessmentCriteria.id, concerns));

    return {
      comments: feedback.comments,
      marksAwarded: Number(feedback.marksAwarded ?? 0),
      marksAvailable: Number(feedback.marksAvailable ?? 0),
      returnedAt: feedback.returnedAt,
      criteriaOfConcern: criteria,
    };
  });
}

// ---------------------------------------------------------------------------
// Tagging a question to what it evidences
// ---------------------------------------------------------------------------

export async function tagItemCriteria(
  session: AuthenticatedSession,
  itemId: string,
  criterionIds: string[],
) {
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, async (tx) => {
    await tx
      .delete(assessmentItemCriteria)
      .where(eq(assessmentItemCriteria.itemId, itemId));

    if (criterionIds.length === 0) return [];

    return tx
      .insert(assessmentItemCriteria)
      .values(
        criterionIds.map((criterionId) => ({
          organisationId: session.organisationId,
          itemId,
          criterionId,
        })),
      )
      .onConflictDoNothing()
      .returning();
  });
}

/** Every question waiting on an assessor, across this tenant. */
export async function markingQueue(session: AuthenticatedSession) {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, async (tx) => {
    const waiting = await tx
      .select({
        submissionId: assessmentSubmissions.id,
        assessmentId: assessmentSubmissions.assessmentId,
        userId: assessmentSubmissions.userId,
        attemptNumber: assessmentSubmissions.attemptNumber,
        submittedAt: assessmentSubmissions.submittedAt,
        title: assessments.title,
        purpose: assessments.purpose,
      })
      .from(assessmentSubmissions)
      .innerJoin(
        assessments,
        eq(assessments.id, assessmentSubmissions.assessmentId),
      )
      .where(
        and(
          inArray(assessmentSubmissions.status, ["submitted", "finalised"]),
          eq(assessments.status, "published"),
        ),
      )
      .orderBy(asc(assessmentSubmissions.submittedAt));

    // A summative waits for a decision; a workbook waits for feedback. Both
    // are "waiting on a person", and separating them is the assessor's first
    // question on opening the list.
    return waiting.filter((row) => row.userId !== session.userId);
  });
}

export type RubricView = {
  id: string;
  title: string;
  dimensions: { id: string; title: string }[];
  levels: { id: string; label: string; minPercent: number; maxPercent: number }[];
  /** Cell text, keyed "dimensionId:levelId". */
  descriptors: Record<string, string>;
};

/** Every rubric a paper's questions use, for the marking screen. */
export async function rubricsForPaper(
  session: AuthenticatedSession,
  submissionId: string,
): Promise<Record<string, RubricView>> {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, async (tx) => {
    const paper = await readMarkedPaper(tx, submissionId);
    const ids = [
      ...new Set(paper.items.map((item) => item.rubricId).filter(Boolean)),
    ] as string[];

    if (ids.length === 0) return {};

    const [dimensions, levels, descriptors] = await Promise.all([
      tx
        .select()
        .from(rubricDimensions)
        .where(inArray(rubricDimensions.rubricId, ids))
        .orderBy(asc(rubricDimensions.sortOrder)),
      tx
        .select()
        .from(rubricLevels)
        .where(inArray(rubricLevels.rubricId, ids))
        .orderBy(asc(rubricLevels.sortOrder)),
      tx.select().from(rubricDescriptors),
    ]);

    const out: Record<string, RubricView> = {};
    for (const id of ids) {
      const ownDimensions = dimensions.filter((d) => d.rubricId === id);
      const ownLevels = levels.filter((l) => l.rubricId === id);
      const dimensionIds = new Set(ownDimensions.map((d) => d.id));

      out[id] = {
        id,
        title: "Marking matrix",
        dimensions: ownDimensions.map((d) => ({ id: d.id, title: d.title })),
        levels: ownLevels.map((l) => ({
          id: l.id,
          label: l.label,
          minPercent: l.minPercent,
          maxPercent: l.maxPercent,
        })),
        descriptors: Object.fromEntries(
          descriptors
            .filter((cell) => dimensionIds.has(cell.dimensionId))
            .map((cell) => [`${cell.dimensionId}:${cell.levelId}`, cell.descriptor]),
        ),
      };
    }

    return out;
  });
}
