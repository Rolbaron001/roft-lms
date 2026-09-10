"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  commentOnSection,
  markItem,
  MarkingError,
  returnFeedback,
} from "@/lib/marking";
import { PermissionDeniedError } from "@/lib/rbac";

export type MarkState = { error?: string; marked?: string };

export type SectionState = { error?: string; saved?: string };

/**
 * A facilitator's comment on one section of the learner's work.
 *
 * Its own action rather than part of returning the paper, because a
 * facilitator writes these as they read - section by section, alongside the
 * questions - and losing them all because the final submit failed would be
 * the worst possible moment to lose them.
 */
export async function commentOnSectionAction(
  _previous: SectionState,
  formData: FormData,
): Promise<SectionState> {
  const session = await requirePermission("assessment:assess");
  const submissionId = String(formData.get("submissionId") ?? "");
  const sectionId = String(formData.get("sectionId") ?? "");

  try {
    await commentOnSection(session, {
      submissionId,
      sectionId,
      comments: String(formData.get("comments") ?? ""),
    });
  } catch (error) {
    if (error instanceof MarkingError || error instanceof PermissionDeniedError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/assess/${submissionId}/mark`);
  return { saved: sectionId };
}

export async function markItemAction(
  _previous: MarkState,
  formData: FormData,
): Promise<MarkState> {
  const session = await requirePermission("assessment:assess");

  const submissionId = String(formData.get("submissionId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const rawMarks = String(formData.get("marks") ?? "").trim();

  // Levels arrive as one field per dimension, named level:<dimensionId>.
  const levels: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("level:") && typeof value === "string" && value) {
      levels[key.slice("level:".length)] = value;
    }
  }

  try {
    await markItem(session, {
      submissionId,
      itemId,
      marks: rawMarks === "" ? undefined : Number(rawMarks),
      rubricLevels: Object.keys(levels).length > 0 ? levels : undefined,
      comment: String(formData.get("comment") ?? ""),
    });
  } catch (error) {
    if (error instanceof MarkingError || error instanceof PermissionDeniedError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/assess/${submissionId}/mark`);
  return { marked: itemId };
}

export async function returnFeedbackAction(
  _previous: MarkState,
  formData: FormData,
): Promise<MarkState> {
  const session = await requirePermission("assessment:assess");
  const submissionId = String(formData.get("submissionId") ?? "");

  try {
    await returnFeedback(session, {
      submissionId,
      comments: String(formData.get("comments") ?? ""),
      criteriaOfConcern: formData
        .getAll("criteriaOfConcern")
        .map(String)
        .filter(Boolean),
    });
  } catch (error) {
    if (error instanceof MarkingError || error instanceof PermissionDeniedError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/assess/${submissionId}/mark`);
  revalidatePath("/assess");
  return {};
}
