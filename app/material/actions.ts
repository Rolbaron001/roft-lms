"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { linkLibraryItem, removeLibraryItem, unlinkLibraryItem } from "@/lib/library";
import { UploadError } from "@/lib/uploads";
import { PermissionDeniedError } from "@/lib/rbac";

export type MaterialState = { error?: string; done?: string };

async function run(work: () => Promise<unknown>, done: string): Promise<MaterialState> {
  try {
    await work();
  } catch (error) {
    if (error instanceof UploadError || error instanceof PermissionDeniedError) return said({ error: error.message });
    throw error;
  }
  revalidatePath("/material");
  revalidatePath("/courses", "layout");
  return said({ done });
}

export async function linkMaterialAction(_previous: MaterialState, formData: FormData): Promise<MaterialState> {
  const session = await requirePermission("course:author");
  const studyUnitId = String(formData.get("studyUnitId") ?? "");
  if (!studyUnitId) return said({ error: "Choose a study unit." });
  return run(
    () => linkLibraryItem(session, String(formData.get("itemId") ?? ""), studyUnitId, String(formData.get("releaseWithStepId") ?? "") || null),
    "Added to the study unit.",
  );
}

export async function unlinkMaterialAction(_previous: MaterialState, formData: FormData): Promise<MaterialState> {
  const session = await requirePermission("course:author");
  return run(() => unlinkLibraryItem(session, String(formData.get("linkId") ?? "")), "Taken off the study unit.");
}

export async function removeMaterialAction(_previous: MaterialState, formData: FormData): Promise<MaterialState> {
  const session = await requirePermission("course:author");
  return run(() => removeLibraryItem(session, String(formData.get("itemId") ?? "")), "Removed from the library.");
}
