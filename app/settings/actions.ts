"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { updateOwnBranding } from "@/lib/provisioning";
import { PermissionDeniedError } from "@/lib/rbac";

export type BrandingState = { error?: string; notice?: string };

export async function updateBrandingAction(
  _previous: BrandingState,
  formData: FormData,
): Promise<BrandingState> {
  const session = await requireSession();

  try {
    await updateOwnBranding(session, {
      displayName: String(formData.get("displayName") ?? ""),
      primaryColour: String(formData.get("primaryColour") ?? ""),
      accentColour: String(formData.get("accentColour") ?? ""),
      logoUrl: String(formData.get("logoUrl") ?? "") || undefined,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    if (error && typeof error === "object" && "issues" in error) {
      return {
        error: (error as { issues: { message: string }[] }).issues
          .map((issue) => issue.message)
          .join(" "),
      };
    }
    console.error(error);
    return { error: "That could not be saved. Please try again." };
  }

  // Branding shows in the header of every page, so refresh the whole tree.
  revalidatePath("/", "layout");
  return { notice: "Saved. Everyone sees it from their next page." };
}
