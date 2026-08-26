"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/request";
import {
  authoriseReassessment,
  recordOralAssessment,
  ReassessmentError,
  startOralAttempt,
} from "@/lib/reassessment";
import { PermissionDeniedError } from "@/lib/rbac";

export type ReviewState = { error?: string; done?: string };

async function run(
  work: () => Promise<unknown>,
  done: string,
): Promise<ReviewState> {
  try {
    await work();
  } catch (error) {
    if (
      error instanceof ReassessmentError ||
      error instanceof PermissionDeniedError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/reassessments");
  return { done };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function authoriseAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await requirePermission("enrolment:manage");

  return run(
    () =>
      authoriseReassessment(session, {
        assessmentId: field(formData, "assessmentId"),
        userId: field(formData, "userId"),
        outcome: field(formData, "outcome") as
          | "oral_reassessment"
          | "further_learning"
          | "withdrawn",
        rationale: field(formData, "rationale"),
        employerConsulted: formData.get("employerConsulted") === "on",
        employerRepresentative:
          field(formData, "employerRepresentative") || undefined,
        employerComments: field(formData, "employerComments") || undefined,
      }),
    "The review is recorded.",
  );
}

export async function startOralAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await requirePermission("assessment:assess");

  let submissionId: string | undefined;

  const state = await run(async () => {
    const submission = await startOralAttempt(
      session,
      field(formData, "authorisationId"),
    );
    submissionId = submission.id;
  }, "Oral attempt opened.");

  // Straight into the record: the assessment is being conducted now, and the
  // exchange has to be written down as it happens rather than remembered.
  if (!state.error && submissionId) {
    redirect(`/reassessments/${submissionId}`);
  }

  return state;
}

/**
 * Saves what was asked and answered.
 *
 * The rows arrive as three parallel lists, which is what a form of repeated
 * fields gives. Zipped back together here, and any row with nothing in it is
 * dropped rather than rejected — a half-filled spare row is somebody having
 * finished, not an error.
 */
export async function recordOralAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await requirePermission("assessment:assess");
  const submissionId = field(formData, "submissionId");

  const questions = formData.getAll("question").map(String);
  const responses = formData.getAll("response").map(String);
  const criteria = formData.getAll("criterionId").map(String);
  const notes = formData.getAll("note").map(String);

  const exchanges = questions
    .map((question, index) => ({
      question: question.trim(),
      response: (responses[index] ?? "").trim(),
      criterionId: (criteria[index] ?? "").trim() || undefined,
      note: (notes[index] ?? "").trim() || undefined,
    }))
    .filter((row) => row.question.length > 0 && row.response.length > 0);

  if (exchanges.length === 0) {
    return {
      error:
        "Write down at least one question and the answer given. An oral pass with no record of the exchange is not evidence.",
    };
  }

  const state = await run(
    () =>
      recordOralAssessment(session, {
        submissionId,
        medium: field(formData, "medium") || undefined,
        witnessName: field(formData, "witnessName") || undefined,
        exchanges,
      }),
    "Saved.",
  );

  revalidatePath(`/reassessments/${submissionId}`);
  return state;
}
