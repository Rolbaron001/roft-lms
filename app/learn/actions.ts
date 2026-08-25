"use server";

import { recordStepOpened, SpineError } from "@/lib/spine";
import { revalidatePath } from "next/cache";
import { requestContext, requireSession } from "@/lib/request";
import { EnrolmentError, markLessonComplete } from "@/lib/enrolment";
import { AssessmentError, submitQuiz } from "@/lib/assessment";
import { PermissionDeniedError } from "@/lib/rbac";

export type LearnState = { error?: string };

export type QuizState = {
  error?: string;
  result?: {
    score: number;
    maxScore: number;
    passed: boolean;
    awaitingAssessor: boolean;
  };
};

export async function submitQuizAction(
  _previous: QuizState,
  formData: FormData,
): Promise<QuizState> {
  const session = await requireSession();

  // Answers arrive as item:<id> fields. Radio buttons contribute one value,
  // checkboxes several, so every field is collected as a list.
  const responses: Record<string, string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("item:")) continue;
    const itemId = key.slice("item:".length);
    responses[itemId] = [...(responses[itemId] ?? []), String(value)];
  }

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
