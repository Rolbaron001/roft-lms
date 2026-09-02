"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  RecordsError,
  fileLibraryDocument,
  recordDisposal,
} from "@/lib/records";
import { PermissionDeniedError } from "@/lib/rbac";

export type RecordsActionState = { error?: string; notice?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function explain(error: unknown): RecordsActionState {
  if (error instanceof RecordsError) return { error: error.message };
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

export async function fileDocumentAction(
  _previous: RecordsActionState,
  formData: FormData,
): Promise<RecordsActionState> {
  const session = await requirePermission("records:manage");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file." };
  }

  try {
    await fileLibraryDocument(session, {
      category: field(formData, "category") as
        | "policy"
        | "accreditation"
        | "contract"
        | "statutory"
        | "operational"
        | "other",
      title: field(formData, "title"),
      description: field(formData, "description") || undefined,
      reference: field(formData, "reference") || undefined,
      version: field(formData, "version") || undefined,
      effectiveFrom: field(formData, "effectiveFrom") || undefined,
      expiresOn: field(formData, "expiresOn") || undefined,
      supersedesId: field(formData, "supersedesId") || undefined,
      visibleToAll: formData.get("visibleToAll") === "on",
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/records");
  return { notice: "Filed." };
}

export async function recordDisposalAction(
  _previous: RecordsActionState,
  formData: FormData,
): Promise<RecordsActionState> {
  const session = await requirePermission("records:manage");

  try {
    await recordDisposal(session, {
      subject: field(formData, "subject") as
        | "learner_documents"
        | "assessment_evidence"
        | "library_document",
      learnerId: field(formData, "learnerId") || undefined,
      libraryDocumentId: field(formData, "libraryDocumentId") || undefined,
      dueOn: field(formData, "dueOn"),
      status: field(formData, "status") as
        | "archived"
        | "destroyed"
        | "retained",
      reason: field(formData, "reason") || undefined,
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/records");
  return { notice: "Recorded." };
}
