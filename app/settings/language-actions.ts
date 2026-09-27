"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { LanguageError, setProviderLocale } from "@/lib/language";
import { PermissionDeniedError } from "@/lib/rbac";

export type ProviderLanguageState = { error?: string; notice?: string };

/** The provider's default language (job sheet D9). */
export async function setProviderLanguageAction(
  _previous: ProviderLanguageState,
  formData: FormData,
): Promise<ProviderLanguageState> {
  const session = await requireSession();
  try {
    await setProviderLocale(session, String(formData.get("locale") ?? ""));
  } catch (error) {
    if (error instanceof LanguageError) return { error: error.message };
    if (error instanceof PermissionDeniedError) return { error: "Only a provider administrator may change this." };
    throw error;
  }
  revalidatePath("/", "layout");
  return { notice: "Saved. People who have not chosen their own language now see this one." };
}
