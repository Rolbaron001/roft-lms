"use server";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/request";
import { captureFiledDocument } from "@/lib/capture-from-documents";
import { CaptureError } from "@/lib/capture";
import { NotReadyError } from "@/lib/programme-readiness";

export type CaptureFiledState = { error?: string };

/**
 * Captures a paper the platform already holds.
 *
 * Roland, 21 September: "The workbooks and assessments are in the folder, they
 * have been read and linked. Why can't they just be captured?"
 *
 * They can. This reads the bytes back out of the store, pairs the answer guide
 * by the tenant's own naming convention, and lands on the review screen - the
 * same review an uploaded paper gets, because that is the part that must not
 * be skipped.
 */
export async function captureFiledAction(
  _previous: CaptureFiledState,
  formData: FormData,
): Promise<CaptureFiledState> {
  const session = await requirePermission("assessment:author");

  const qualificationId = String(formData.get("qualificationId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");

  let jobId: string;
  let assessmentId: string | null = null;
  try {
    const result = await captureFiledDocument(session, {
      qualificationId,
      documentId,
    });
    jobId = result.jobId;
    assessmentId = result.assessmentId;
  } catch (error) {
    if (error instanceof NotReadyError || error instanceof CaptureError) {
      return { error: error.message };
    }
    if (error instanceof Error) return { error: error.message };
    throw error;
  }

  // Outside the try: redirect() throws to do its work, and catching it here
  // would swallow the navigation and report it as a failure.
  /*
   * The assessment travels in the address rather than being stored on the job.
   * It is a suggestion for one screen, not a decision: the reviewer can pick a
   * different one, and nothing has been committed to it yet.
   */
  redirect(
    assessmentId
      ? `/capture/${jobId}?assessment=${assessmentId}`
      : `/capture/${jobId}`,
  );
}
