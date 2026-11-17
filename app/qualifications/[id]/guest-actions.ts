"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { setOpenToGuests } from "@/lib/guest";

/** Opens a qualification to guests, or closes it (D51). */
export async function setOpenToGuestsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("qualification:manage");
  const id = String(formData.get("qualificationId") ?? "");
  await setOpenToGuests(session, id, formData.get("open") === "1");
  revalidatePath(`/qualifications/${id}`);
}
