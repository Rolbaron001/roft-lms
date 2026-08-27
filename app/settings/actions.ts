"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { updateOwnBranding } from "@/lib/provisioning";
import { CaptureError, setNamingConvention } from "@/lib/capture";
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
      signInGraphicUrl:
        String(formData.get("signInGraphicUrl") ?? "") || undefined,
      strapline: String(formData.get("strapline") ?? "") || undefined,
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

export type NamingState = { error?: string; done?: string };

/**
 * Saves how this tenant's filenames are read.
 *
 * The codes arrive as two parallel lists, which is what a form of repeated
 * fields gives. Zipped back together here, and a row left blank is dropped
 * rather than rejected — an empty spare row is somebody having finished.
 */
export async function updateNamingAction(
  _previous: NamingState,
  formData: FormData,
): Promise<NamingState> {
  const session = await requireSession();

  const codes = formData.getAll("code").map(String);
  const meanings = formData.getAll("meaning").map(String);

  const artefactCodes: Record<string, string> = {};
  codes.forEach((code, index) => {
    const trimmed = code.trim().toUpperCase();
    const meaning = (meanings[index] ?? "").trim();
    if (trimmed && meaning) artefactCodes[trimmed] = meaning;
  });

  try {
    await setNamingConvention(session, {
      pattern: String(formData.get("pattern") ?? ""),
      artefactCodes,
      memorandumMarker: String(formData.get("memorandumMarker") ?? ""),
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    if (error instanceof CaptureError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/settings");
  revalidatePath("/capture");
  return { done: "Saved. Uploads from now on are read this way." };
}
