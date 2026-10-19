"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession, said } from "@/lib/request";
import { confirmChecklist, PreAssessmentError } from "@/lib/pre-assessment";

export type ChecklistState = { error?: string };

/** A learner confirms the pre-assessment checklist for a study unit. */
export async function confirmChecklistAction(_previous: ChecklistState, formData: FormData): Promise<ChecklistState> {
  const session = await requireSession();
  const enrolmentId = String(formData.get("enrolmentId") ?? "");
  try {
    await confirmChecklist(session, {
      courseId: String(formData.get("courseId") ?? ""),
      ticked: formData.getAll("item").length,
      declarationAccepted: formData.get("declaration") === "on",
      ipAddress: (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  } catch (error) {
    if (error instanceof PreAssessmentError) return said({ error: error.message });
    throw error;
  }
  revalidatePath(`/learn/${enrolmentId}`);
  return {};
}
