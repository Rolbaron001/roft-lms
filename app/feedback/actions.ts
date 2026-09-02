"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireSession } from "@/lib/request";
import {
  FeedbackError,
  activeQuestionnaire,
  requestFeedback,
  submitFeedback,
} from "@/lib/feedback";
import { PermissionDeniedError } from "@/lib/rbac";

export type FeedbackActionState = { error?: string; notice?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function explain(error: unknown): FeedbackActionState {
  if (error instanceof FeedbackError) return { error: error.message };
  if (error instanceof PermissionDeniedError) {
    return { error: "Your role does not allow that." };
  }
  if (error && typeof error === "object" && "issues" in error) {
    return {
      error: (error as { issues: { message: string }[] }).issues
        .map((issue) => issue.message)
        .join(" "),
    };
  }
  console.error(error);
  return { error: "That could not be saved. Please try again." };
}

export async function requestFeedbackAction(
  _previous: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const session = await requirePermission("session:manage");
  const cohortId = field(formData, "cohortId");

  try {
    await requestFeedback(session, {
      cohortId,
      assessmentId: field(formData, "assessmentId") || undefined,
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/cohorts/${cohortId}`);
  return { notice: "Asked. They have 48 hours." };
}

export async function submitFeedbackAction(
  _previous: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const session = await requireSession();
  const requestId = field(formData, "requestId");

  // The questionnaire decides what is collected, so the form is read against
  // it rather than against whatever the browser chose to send.
  const questionnaire = await activeQuestionnaire(session);
  const answers: Record<string, string | number> = {};
  for (const question of questionnaire.questions) {
    const raw = field(formData, question.key);
    if (raw === "") continue;
    answers[question.key] = question.kind === "rating" ? Number(raw) : raw;
  }

  try {
    await submitFeedback(session, { requestId, answers });
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/");
  redirect("/?feedback=thanks");
}
