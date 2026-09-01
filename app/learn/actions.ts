"use server";

import { recordStepOpened, SpineError } from "@/lib/spine";
import { revalidatePath } from "next/cache";
import { requestContext, requireSession } from "@/lib/request";
import { EnrolmentError, markLessonComplete } from "@/lib/enrolment";
import { AssessmentError, saveQuizDraft, submitQuiz } from "@/lib/assessment";
import { PermissionDeniedError } from "@/lib/rbac";

export type LearnState = { error?: string };

export type QuizState = {
  error?: string;
  /** When a draft was last kept, so the learner can see it happened. */
  savedAt?: string;
  result?: {
    score: number;
    maxScore: number;
    passed: boolean;
    awaitingAssessor: boolean;
  };
};

/**
 * Reads a workbook form into the shape a submission stores.
 *
 * Two kinds of field, and they are kept in separate keys rather than merged
 * into one list:
 *
 *   item:<id>   a chosen option, or "promptId:optionId" for a matching pair.
 *               Radio buttons contribute one, checkboxes and matching several.
 *   text:<id>   what the learner wrote, stored under "text:<id>".
 *
 * Merging prose into the same list as the choices would work right up until a
 * true-or-false-with-justification item was left unanswered, at which point a
 * one-element list could be either the choice or the justification and nothing
 * could tell them apart. The marking engine only ever looks up an item by its
 * own id, so the text keys sit alongside harmlessly.
 */
function collectAnswers(formData: FormData): Record<string, string[]> {
  const responses: Record<string, string[]> = {};

  for (const [key, value] of formData.entries()) {
    const text = String(value);

    if (key.startsWith("item:")) {
      const itemId = key.slice("item:".length);
      responses[itemId] = [...(responses[itemId] ?? []), text];
      continue;
    }

    if (key.startsWith("text:")) {
      // Blank textareas are dropped rather than stored as empty strings, so an
      // unanswered question reads as unanswered rather than as an empty one.
      if (text.trim().length === 0) continue;
      responses[key] = [text];
    }
  }

  return responses;
}

export async function submitQuizAction(
  _previous: QuizState,
  formData: FormData,
): Promise<QuizState> {
  const session = await requireSession();

  const responses = collectAnswers(formData);

  try {
    const context = await requestContext();
    const result = await submitQuiz(session, {
      assessmentId: String(formData.get("assessmentId") ?? ""),
      enrolmentId: String(formData.get("enrolmentId") ?? "") || null,
      responses,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    revalidatePath(`/learn/${formData.get("enrolmentId")}`);

    return {
      result: {
        score: result.score,
        maxScore: result.maxScore,
        passed: result.passed,
        awaitingAssessor: result.awaitingAssessor,
      },
    };
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    if (error instanceof AssessmentError) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "That could not be submitted. Please try again." };
  }
}

export async function markLessonCompleteAction(
  _previous: LearnState,
  formData: FormData,
): Promise<LearnState> {
  const session = await requireSession();
  const enrolmentId = String(formData.get("enrolmentId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  try {
    await markLessonComplete(session, enrolmentId, lessonId);
  } catch (error) {
    if (error instanceof EnrolmentError || error instanceof SpineError) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "That could not be saved. Please try again." };
  }

  revalidatePath(`/learn/${enrolmentId}`);
  revalidatePath("/");
  return {};
}

/**
 * Records that a learner opened a step.
 *
 * The guard runs inside `recordStepOpened`, so a learner asking to open a
 * locked step is refused here as well as in the page that would have hidden
 * it.
 */
export async function openStepAction(
  _previous: LearnState,
  formData: FormData,
): Promise<LearnState> {
  const session = await requireSession();
  const stepId = String(formData.get("stepId") ?? "");
  const enrolmentId = String(formData.get("enrolmentId") ?? "");

  try {
    await recordStepOpened(session, stepId);
  } catch (error) {
    if (error instanceof SpineError) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "That could not be opened. Please try again." };
  }

  revalidatePath(`/learn/${enrolmentId}`);
  return {};
}

/**
 * Keeps what the learner has written so far, without submitting it.
 *
 * Called as they work. It spends no attempt and marks nothing; `submitQuiz`
 * finishes the same draft rather than opening a second one.
 */
export async function saveQuizDraftAction(
  _previous: QuizState,
  formData: FormData,
): Promise<QuizState> {
  const session = await requireSession();

  try {
    const saved = await saveQuizDraft(session, {
      assessmentId: String(formData.get("assessmentId") ?? ""),
      enrolmentId: String(formData.get("enrolmentId") ?? "") || null,
      responses: collectAnswers(formData),
    });
    return { savedAt: saved.savedAt.toISOString() };
  } catch (error) {
    if (error instanceof AssessmentError) return { error: error.message };
    throw error;
  }
}
