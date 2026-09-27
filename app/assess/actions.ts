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

  // Per-criterion judgements arrive as criterion:<id> fields, what the marks
  // proposed as proposed:<id>, and the assessor's reasons as note:<id>.
  type Outcome = "competent" | "not_yet_competent";
  const criterionOutcomes: Record<string, Outcome> = {};
  const criterionProposed: Record<string, Outcome> = {};
  const criterionNotes: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    const at = key.indexOf(":");
    if (at < 0) continue;
    const [kind, id] = [key.slice(0, at), key.slice(at + 1)];
    if (kind === "criterion") criterionOutcomes[id] = String(value) as Outcome;
    if (kind === "proposed") criterionProposed[id] = String(value) as Outcome;
    if (kind === "note" && String(value).trim()) criterionNotes[id] = String(value);
  }
  const some = <T,>(record: Record<string, T>) =>
    Object.keys(record).length > 0 ? record : undefined;

  try {
    await recordAssessorDecision(session, {
      submissionId,
      outcome: formData.get("outcome") as "competent",
      comments: String(formData.get("comments") ?? "") || undefined,
      criterionOutcomes: some(criterionOutcomes),
      criterionProposed: some(criterionProposed),
      criterionNotes: some(criterionNotes),
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
