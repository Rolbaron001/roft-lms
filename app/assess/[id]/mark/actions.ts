"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import {
  commentOnSection,
  markItem,
  MarkingError,
  returnFeedback,
} from "@/lib/marking";
import { PermissionDeniedError } from "@/lib/rbac";
import { removeFeedbackFile, uploadFeedbackFile, UploadError } from "@/lib/uploads";

export type MarkState = { error?: string; marked?: string; returned?: boolean };

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
      return said({ error: error.message });
    }
    throw error;
  }

  revalidatePath(`/assess/${submissionId}/mark`);
  return said({ saved: sectionId });
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
      overrideReason: String(formData.get("overrideReason") ?? ""),
    });
  } catch (error) {
    if (error instanceof MarkingError || error instanceof PermissionDeniedError) {
      return said({ error: error.message });
    }
    throw error;
  }

  revalidatePath(`/assess/${submissionId}/mark`);
  return said({ marked: itemId });
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
      return said({ error: error.message });
    }
    throw error;
  }

  revalidatePath(`/assess/${submissionId}/mark`);
  revalidatePath("/assess");
  revalidatePath("/");
  return said({ returned: true });
}

export type FileState = { error?: string; added?: number };

/** Attaches a voice note, video or document to the feedback. */
export async function addFeedbackFileAction(
  _previous: FileState,
  formData: FormData,
): Promise<FileState> {
  const session = await requirePermission("assessment:assess");
  const submissionId = String(formData.get("submissionId") ?? "");
  const files = formData.getAll("file").filter((one): one is File => one instanceof File && one.size > 0);
  if (files.length === 0) return said({ error: "Choose a file." });

  try {
    for (const file of files) {
      await uploadFeedbackFile(session, submissionId, {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
  } catch (error) {
    if (error instanceof UploadError || error instanceof PermissionDeniedError) {
      return said({ error: error.message });
    }
    throw error;
  }

  revalidatePath(`/assess/${submissionId}/mark`);
  return said({ added: files.length });
}

export async function removeFeedbackFileAction(formData: FormData) {
  const session = await requirePermission("assessment:assess");
  const submissionId = await removeFeedbackFile(session, String(formData.get("attachmentId") ?? ""));
  revalidatePath(`/assess/${submissionId}/mark`);
}
