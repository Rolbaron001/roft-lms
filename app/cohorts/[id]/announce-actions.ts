"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { postAnnouncement } from "@/lib/announcements";
import { CohortError } from "@/lib/cohorts";

export type AnnounceState = { error?: string; notice?: string };

/** Posts a facilitator's announcement to a cohort (job sheet D52 (1)). */
export async function postAnnouncementAction(_previous: AnnounceState, formData: FormData): Promise<AnnounceState> {
  const session = await requirePermission("session:manage");
  const cohortId = String(formData.get("cohortId") ?? "");
  try {
    const result = await postAnnouncement(session, {
      cohortId,
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
      email: formData.get("email") === "on",
    });
    revalidatePath(`/cohorts/${cohortId}`);
    return said({
      notice:
        result.reached === 1
          ? "Posted. It has reached the cohort's one learner."
          : `Posted. It has reached the cohort's ${result.reached} learners.`,
    });
  } catch (error) {
    if (error instanceof CohortError) return said({ error: error.message });
    throw error;
  }
}
