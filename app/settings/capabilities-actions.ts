"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { setTenantCapabilities } from "@/lib/provisioning";

import { PermissionDeniedError } from "@/lib/rbac";

export type CapabilitiesState = { error?: string; saved?: boolean };

/**
 * Saves the shape of this provider's platform.
 *
 * Two questions with one answer each, and two ordinary switches. Nothing here
 * trusts the browser: the award and the delivery are checked against the known
 * choices in structureOf, which also refuses the one combination that cannot
 * exist, study units with no qualification above them.
 */
export async function updateCapabilitiesAction(
  _previous: CapabilitiesState,
  formData: FormData,
): Promise<CapabilitiesState> {
  try {
    const session = await requirePermission("tenant:manage_settings");

    await setTenantCapabilities(session, {
      award: String(formData.get("award") ?? ""),
      delivery: String(formData.get("delivery") ?? ""),
      // An unticked box posts nothing, so absence is the answer here rather
      // than a missing field.
      statutory_reporting: formData.get("statutory_reporting") === "on",
      workplace_experience: formData.get("workplace_experience") === "on",
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    throw error;
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { saved: true };
}
