"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { addToSample } from "@/lib/moderation-sample";

export type SampleState = { error?: string; notice?: string };

/** Adds the ticked decisions to the moderation sample (job sheet D52 (3)). */
export async function addToSampleAction(_previous: SampleState, formData: FormData): Promise<SampleState> {
  const session = await requirePermission("assessment:moderate");
  const ids = formData.getAll("decisionId").map(String).filter(Boolean);
  if (ids.length === 0) return said({ error: "Tick the decisions to add to the sample." });
  const added = await addToSample(session, ids);
  revalidatePath("/moderate/decisions");
  revalidatePath("/moderate");
  return said({
    notice:
      added === 0
        ? "Those were already in the sample."
        : added === 1
          ? "One decision added to the sample. It is in your moderation queue."
          : `${added} decisions added to the sample. They are in your moderation queue.`,
  });
}
