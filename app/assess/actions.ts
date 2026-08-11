"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/request";
import {
  AssessmentError,
  recordAssessorDecision,
  recordModeration,
} from "@/lib/assessment";
import { PermissionDeniedError } from "@/lib/rbac";

export type DecisionState = { error?: string; notice?: string };

function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof AssessmentError) {
    return error.message;
  }
  console.error(error);
  return "That could not be saved. Please try again.";
}

export async function recordDecisionAction(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const session = await requireSession();
  const submissionId = String(formData.get("submissionId") ?? "");

  // Per-criterion judgements arrive as criterion:<id> fields.
  const criterionOutcomes: Record<string, "competent" | "not_yet_competent"> =
    {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("criterion:")) {
      criterionOutcomes[key.slice("criterion:".length)] = String(value) as
        | "competent"
        | "not_yet_competent";
    }
  }

  try {
    await recordAssessorDecision(session, {
      submissionId,
      outcome: formData.get("outcome") as "competent",
      comments: String(formData.get("comments") ?? "") || undefined,
      criterionOutcomes:
        Object.keys(criterionOutcomes).length > 0
          ? criterionOutcomes
          : undefined,
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/assess");
  redirect("/assess");
}

export async function recordModerationAction(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const session = await requireSession();

  try {
    await recordModeration(session, {
      decisionId: String(formData.get("decisionId") ?? ""),
      outcome: formData.get("outcome") as "endorsed",
      comments: String(formData.get("comments") ?? "") || undefined,
      revisedOutcome:
        (String(formData.get("revisedOutcome") ?? "") as "competent") ||
        undefined,
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/moderate");
  return { notice: "Recorded." };
}
