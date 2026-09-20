"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { PermissionDeniedError } from "@/lib/rbac";
import {
  QualificationInUseError,
  deleteQualification,
} from "@/lib/qualification-removal";

export type RemoveState = { error?: string };

/**
 * Removing a qualification nothing has happened against.
 *
 * The confirmation is typed rather than a second button. A qualification is
 * the root of everything a provider builds - its curriculum, its study units,
 * every document filed against it - and a misplaced click should not be able
 * to take all of it. Typing the title is the cheapest way to be certain the
 * person means this qualification rather than the one they were looking at a
 * moment ago.
 */
export async function removeQualificationAction(
  _previous: RemoveState,
  formData: FormData,
): Promise<RemoveState> {
  const session = await requirePermission("qualification:manage");

  const id = String(formData.get("qualificationId") ?? "");
  const typed = String(formData.get("confirm") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  if (typed !== title) {
    return {
      error:
        "That is not the title. Type it exactly as it appears above to confirm which qualification you mean.",
    };
  }

  try {
    await deleteQualification(session, id);
  } catch (error) {
    if (error instanceof QualificationInUseError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not include managing qualifications." };
    }
    return {
      error:
        error instanceof Error
          ? error.message
          : "That qualification could not be removed.",
    };
  }

  revalidatePath("/qualifications");
  // Nowhere to go back to - the page this was pressed on no longer exists.
  redirect("/qualifications");
}
