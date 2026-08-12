"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { markAllRead, markRead } from "@/lib/notifications";

export async function markAllReadAction(): Promise<void> {
  const session = await requireSession();
  await markAllRead(session);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markReadAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  await markRead(session, String(formData.get("notificationId") ?? ""));
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
