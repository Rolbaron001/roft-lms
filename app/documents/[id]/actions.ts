"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { DocumentRemovalError, removeProgrammeDocument } from "@/lib/document-removal";
import type { LibraryCategory } from "@/lib/records";

export type RemoveState = { error?: string };

/** Takes one document off its programme, optionally keeping it in the Library (D63). */
export async function removeDocumentAction(_previous: RemoveState, formData: FormData): Promise<RemoveState> {
  const session = await requirePermission("qualification:manage");
  const documentId = String(formData.get("documentId") ?? "");
  const keep = String(formData.get("keepInLibraryAs") ?? "");
  let qualificationId: string | null = null;
  try {
    const result = await removeProgrammeDocument(session, documentId, {
      reason: String(formData.get("reason") ?? ""),
      keepInLibraryAs: keep ? (keep as LibraryCategory) : null,
    });
    qualificationId = result.qualificationId;
  } catch (error) {
    if (error instanceof DocumentRemovalError) return said({ error: error.message });
    throw error;
  }
  if (qualificationId) {
    revalidatePath(`/qualifications/${qualificationId}`);
    revalidatePath(`/qualifications/${qualificationId}/verify`);
    redirect(`/qualifications/${qualificationId}#documents`);
  }
  redirect("/qualifications");
}
