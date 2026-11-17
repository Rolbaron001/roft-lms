"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { liftHold, placeHold, QualityError } from "@/lib/quality";

export type HoldState = { error?: string; notice?: string };

/** Places a compliance hold on a qualification or cohort (D51). */
export async function placeHoldAction(_previous: HoldState, formData: FormData): Promise<HoldState> {
  const session = await requirePermission("quality:hold");
  const target = String(formData.get("target") ?? "");
  const [kind, id] = target.split(":");
  try {
    await placeHold(session, {
      qualificationId: kind === "qualification" ? id : undefined,
      cohortId: kind === "cohort" ? id : undefined,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    if (error instanceof QualityError) return said({ error: error.message });
    throw error;
  }
  revalidatePath("/quality/holds");
  return said({ notice: "Hold placed. No assessment decision, certificate or Statement of Results is recorded for it until it is lifted." });
}

/** Lifts a standing hold. */
export async function liftHoldAction(_previous: HoldState, formData: FormData): Promise<HoldState> {
  const session = await requirePermission("quality:hold");
  try {
    await liftHold(session, String(formData.get("holdId") ?? ""), String(formData.get("note") ?? ""));
  } catch (error) {
    if (error instanceof QualityError) return said({ error: error.message });
    throw error;
  }
  revalidatePath("/quality/holds");
  return said({ notice: "Hold lifted." });
}
