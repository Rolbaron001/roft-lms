"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireSession, said } from "@/lib/request";
import {
  FeedbackError,
  activeQuestionnaire,
  feedbackOwedBy,
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
    return said(explain(error));
  }

  revalidatePath(`/cohorts/${cohortId}`);
  return said({ notice: "Asked. They have 48 hours." });
}

export async function submitFeedbackAction(
  _previous: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const session = await requireSession();
  const requestId = field(formData, "requestId");

  // The questionnaire decides what is collected, so the form is read against
  // it rather than against whatever the browser chose to send. The one this
  // request asked, not today's: a provider may have changed its questions
  // since the request went out (job sheet D20, 9 October 2026).
  const asked = (await feedbackOwedBy(session, session.userId)).find((row) => row.id === requestId);
  const questions = asked?.questions ?? (await activeQuestionnaire(session)).questions;
  const answers: Record<string, string | number> = {};
  for (const question of questions) {
    const raw = field(formData, question.key);
    if (raw === "") continue;
    answers[question.key] = question.kind === "rating" ? Number(raw) : raw;
  }

  try {
    await submitFeedback(session, { requestId, answers });
  } catch (error) {
    return said(explain(error));
  }

  revalidatePath("/");
  redirect("/?feedback=thanks");
}
