"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { setTenantCapabilities } from "@/lib/provisioning";
import { CAPABILITY_KEYS } from "@/lib/features";
import { PermissionDeniedError } from "@/lib/rbac";

export type CapabilitiesState = { error?: string; saved?: boolean };

/**
 * Saves which capabilities this provider's platform has.
 *
 * Read from the known list rather than from whatever the form posted, so a
 * capability the browser did not send is treated as switched off by the person
 * rather than silently kept. An unchecked box posts nothing at all, which is
 * exactly the case this has to get right.
 */
export async function updateCapabilitiesAction(
  _previous: CapabilitiesState,
  formData: FormData,
): Promise<CapabilitiesState> {
  try {
    const session = await requirePermission("tenant:manage_settings");

    await setTenantCapabilities(
      session,
      Object.fromEntries(
        CAPABILITY_KEYS.map((key) => [key, formData.get(key) === "on"]),
      ),
    );
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
