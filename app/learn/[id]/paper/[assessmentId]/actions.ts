"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/request";
import { PaperError, startAttempt } from "@/lib/papers";

/**
 * Starts a new attempt at a paper whose last attempt has been returned. The
 * same rules that decide whether the page offers it are applied again here.
 */
export async function startAgainAction(formData: FormData) {
  const session = await requireSession();
  const enrolmentId = String(formData.get("enrolmentId") ?? "");
  const assessmentId = String(formData.get("assessmentId") ?? "");

  try {
    await startAttempt(session, assessmentId, { enrolmentId, fresh: true });
  } catch (error) {
    if (!(error instanceof PaperError)) throw error;
  }

  redirect(`/learn/${enrolmentId}/paper/${assessmentId}`);
}
