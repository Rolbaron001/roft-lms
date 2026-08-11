"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  addAssessmentItem,
  AssessmentError,
  createAssessment,
  publishAssessment,
} from "@/lib/assessment";
import { PermissionDeniedError } from "@/lib/rbac";

export type AssessmentState = { error?: string; notice?: string };

function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof AssessmentError) {
    return error.message;
  }
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: { message: string }[] }).issues
      .map((issue) => issue.message)
      .join(" ");
  }
  console.error(error);
  return "That could not be saved. Please try again.";
}

export async function createAssessmentAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");

  try {
    await createAssessment(session, {
      courseId,
      title: String(formData.get("title") ?? ""),
      instructions: String(formData.get("instructions") ?? "") || undefined,
      type: (formData.get("type") as "quiz") || "quiz",
      purpose: (formData.get("purpose") as "formative") || "formative",
      passMark: Number(formData.get("passMark") ?? 70),
      moderationSampleRate: Number(formData.get("moderationSampleRate") ?? 0.25),
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/assessments`);
  return { notice: "Assessment created." };
}

export async function addQuestionAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");

  // Options arrive as repeated fields; blank rows are ignored so the author
  // can leave spare boxes empty rather than having to delete them.
  const rawOptions = formData.getAll("option").map(String);
  const options: string[] = [];
  const correctIndexes: number[] = [];

  rawOptions.forEach((text, originalIndex) => {
    if (text.trim().length === 0) return;
    const index = options.length;
    options.push(text.trim());
    if (formData.getAll("correct").map(String).includes(String(originalIndex))) {
      correctIndexes.push(index);
    }
  });

  try {
    await addAssessmentItem(session, {
      assessmentId: String(formData.get("assessmentId") ?? ""),
      stem: String(formData.get("stem") ?? ""),
      type: (formData.get("type") as "multiple_choice") || "multiple_choice",
      options,
      correctIndexes,
      points: Number(formData.get("points") ?? 1),
      criterionId: String(formData.get("criterionId") ?? "") || undefined,
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/assessments`);
  return { notice: "Question added." };
}

export async function publishAssessmentAction(
  _previous: AssessmentState,
  formData: FormData,
): Promise<AssessmentState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");

  try {
    await publishAssessment(session, String(formData.get("assessmentId") ?? ""));
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/assessments`);
  return { notice: "Assessment published." };
}
