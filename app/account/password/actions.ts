"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentLocale, requireSessionForPasswordChange, said } from "@/lib/request";
import { translator } from "@/lib/i18n";
import { LanguageError, setOwnLocale } from "@/lib/language";
import { changeOwnPassword, PeopleError } from "@/lib/people";
import { WeakPasswordError } from "@/lib/password";

export type PasswordState = { error?: string };

export async function changePasswordAction(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const session = await requireSessionForPasswordChange();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // Checked here rather than in the library: it is a typing mistake in this
  // form, not a rule about passwords, and nothing calling changeOwnPassword
  // from elsewhere should have to send the same value twice.
  if (newPassword !== confirmPassword) {
    return said({ error: translator(session.locale ?? (await currentLocale()))("account.mismatch") });
  }

  try {
    await changeOwnPassword(session, currentPassword, newPassword);
  } catch (error) {
    if (error instanceof WeakPasswordError || error instanceof PeopleError) {
      return said({ error: error.message });
    }
    throw error;
  }

  redirect("/");
}

export type LanguageState = { error?: string; notice?: string };

/** A person choosing their own language (job sheet D9). Blank follows the provider's. */
export async function chooseLanguageAction(
  _previous: LanguageState,
  formData: FormData,
): Promise<LanguageState> {
  const session = await requireSessionForPasswordChange();
  const code = String(formData.get("locale") ?? "") || null;
  try {
    await setOwnLocale(session, code);
  } catch (error) {
    if (error instanceof LanguageError) return said({ error: error.message });
    throw error;
  }
  // The whole page, frame and all, now reads in the new language.
  revalidatePath("/", "layout");
  return said({ notice: translator(code ?? (await currentLocale()))("account.languageSaved") });
}
