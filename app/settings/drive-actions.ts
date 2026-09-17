"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  disconnect,
  driveProviderByName,
  DriveError,
  type DriveProviderName,
} from "@/lib/drive";
import { PermissionDeniedError } from "@/lib/rbac";

export type DriveState = { error?: string; done?: string };

/**
 * Forgetting a drive connection.
 *
 * Half the job, and the screen says which half. This removes what the platform
 * holds; the access itself is also withdrawable from the provider's own
 * account page, and somebody who wants it gone everywhere should do both. The
 * platform cannot revoke a token on somebody's behalf at Google — it can only
 * stop holding one.
 */
export async function disconnectDriveAction(
  _previous: DriveState,
  formData: FormData,
): Promise<DriveState> {
  const session = await requirePermission("qualification:manage");
  const name = String(formData.get("provider") ?? "");

  const provider = driveProviderByName(name);
  if (!provider) return { error: "That is not a drive the platform knows." };

  try {
    await disconnect(session, name as DriveProviderName);
  } catch (error) {
    if (error instanceof DriveError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    throw error;
  }

  revalidatePath("/settings");

  return {
    done: `${provider.label} is disconnected here. To withdraw it completely, remove this platform from that account's own list of connected applications.`,
  };
}
