"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { updateOwnBranding, setTenantTimeZone } from "@/lib/provisioning";
import { setMyExtension } from "@/lib/extensions";
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

export type ClockState = { error?: string; notice?: string };

/**
 * Saves the provider's own clock.
 *
 * Separated from branding by permission as well as by form: somebody who can
 * change the logo should not be able to move every timetabled time in the
 * platform by two hours.
 */
export async function updateClockAction(
  _previous: ClockState,
  formData: FormData,
): Promise<ClockState> {
  const session = await requireSession();

  try {
    await setTenantTimeZone(session, String(formData.get("timezone") ?? ""));
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

  // Times appear on the schedule, the register and the sitting, so refresh
  // the whole tree rather than guessing which pages show one.
  revalidatePath("/", "layout");
  return { notice: "Saved. Timetabled times now mean this clock." };
}

export type ExtensionState = { error?: string; notice?: string };

/**
 * One person switching their own AI extension on or off.
 *
 * Against their own profile, under a permission every member of the provider's
 * staff holds rather than the administrator's. What it then lets them do is
 * bounded by their role exactly as everything else is - an assessor with an
 * extension can do assessor things faster, and nothing more.
 */
export async function updateMyExtensionAction(
  _previous: ExtensionState,
  formData: FormData,
): Promise<ExtensionState> {
  const session = await requireSession();

  try {
    await setMyExtension(session, {
      enabled: formData.get("enabled") === "on",
      provider: String(formData.get("provider") ?? "") || null,
      model: String(formData.get("model") ?? "").trim() || null,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error:
          "Your role does not include model assistance. It is held by the provider's own staff rather than by learners or by an employer's workplace coach.",
      };
    }
    console.error(error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "That could not be saved. Please try again.",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/qualifications");
  return { notice: "Saved." };
}
