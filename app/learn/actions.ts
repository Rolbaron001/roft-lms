"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { EnrolmentError, markLessonComplete } from "@/lib/enrolment";

export type LearnState = { error?: string };

export async function markLessonCompleteAction(
  _previous: LearnState,
  formData: FormData,
): Promise<LearnState> {
  const session = await requireSession();
  const enrolmentId = String(formData.get("enrolmentId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  try {
    await markLessonComplete(session, enrolmentId, lessonId);
  } catch (error) {
    if (error instanceof EnrolmentError) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "That could not be saved. Please try again." };
  }

  revalidatePath(`/learn/${enrolmentId}`);
  revalidatePath("/");
  return {};
}
