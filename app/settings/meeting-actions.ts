"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { disconnectMeetingService, meetingProvider } from "@/lib/meetings";
import { PermissionDeniedError } from "@/lib/rbac";

export type MeetingAccountState = { error?: string; done?: string };

/**
 * Forgetting the provider's Google Meet or Microsoft Teams account (D41).
 * Meetings already created keep their links; new sessions are no longer given
 * one. As with a drive, the access itself is withdrawn in the account too.
 */
export async function disconnectMeetingAction(_previous: MeetingAccountState, formData: FormData): Promise<MeetingAccountState> {
  const session = await requirePermission("tenant:manage_settings");
  const provider = meetingProvider(String(formData.get("service") ?? ""));
  if (!provider) return said({ error: "That is not a meeting service the platform knows." });

  try {
    await disconnectMeetingService(session, provider.name);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return said({ error: "Your role does not allow that." });
    throw error;
  }

  revalidatePath("/settings");
  return said({
    done: `${provider.label} is disconnected here. Meetings already created keep their links. To withdraw it completely, remove this platform from that account's connected applications.`,
  });
}
