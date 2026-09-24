"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { PermissionDeniedError } from "@/lib/rbac";
import { courseForStudyUnit } from "@/lib/capture-from-documents";

export type StartState = { error?: string };

/**
 * Gives a study unit somewhere for its material to live.
 *
 * Found on 23 September: four of 121151's five study units had no course
 * behind them, and no screen could make one. `/courses/new` creates a course
 * that answers to nothing, and the only thing in the platform that ever
 * attached one to a study unit was capturing a workbook into it. So a
 * provider who had not captured anything yet had no route at all, and the
 * preview could name the gap without offering any way to close it.
 *
 * `courseForStudyUnit` already does exactly this and is already idempotent:
 * it returns the existing course where there is one, so pressing twice makes
 * one course rather than two.
 */
export async function startStudyUnitAction(
  _previous: StartState,
  formData: FormData,
): Promise<StartState> {
  const session = await requireSession();
  const qualificationId = String(formData.get("qualificationId") ?? "");
  const studyUnitId = String(formData.get("studyUnitId") ?? "");

  let courseId: string;
  try {
    courseId = await courseForStudyUnit(session, studyUnitId);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    throw error;
  }

  revalidatePath(`/qualifications/${qualificationId}/preview`);
  // Straight to the empty list, which is the next thing to do rather than
  // back to a page that now says one fewer thing is missing.
  redirect(`/courses/${courseId}/steps`);
}
