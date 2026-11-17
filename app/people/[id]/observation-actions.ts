"use server";

import { revalidatePath } from "next/cache";
import { requireSession, said } from "@/lib/request";
import { logObservation, ObservationError } from "@/lib/observations";

export type ObservationState = { error?: string; notice?: string };

/** Logs an observation of a learner (job sheet D52 (2)). */
export async function logObservationAction(_previous: ObservationState, formData: FormData): Promise<ObservationState> {
  const session = await requireSession();
  const learnerId = String(formData.get("learnerId") ?? "");
  try {
    await logObservation(session, {
      learnerId,
      kind: String(formData.get("kind") ?? ""),
      observedOn: String(formData.get("observedOn") ?? ""),
      note: String(formData.get("note") ?? ""),
      cohortId: String(formData.get("cohortId") ?? "") || null,
    });
    revalidatePath(`/people/${learnerId}`);
    return said({ notice: "Logged." });
  } catch (error) {
    if (error instanceof ObservationError) return said({ error: error.message });
    throw error;
  }
}
