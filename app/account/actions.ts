"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { setMyExtension } from "@/lib/extensions";
import { PermissionDeniedError } from "@/lib/rbac";

export type AccountActionState = { error?: string; notice?: string };

/**
 * One person switching their own AI extension on or off.
 *
 * Theirs rather than the tenant's, so it revalidates only their own pages.
 */
export async function updateMyExtensionAction(
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
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

  revalidatePath("/account");
  revalidatePath("/imports");
  return { notice: "Saved." };
}
