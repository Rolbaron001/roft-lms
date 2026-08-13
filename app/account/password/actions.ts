"use server";

import { redirect } from "next/navigation";
import { requireSessionForPasswordChange } from "@/lib/request";
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
    return { error: "The two new passwords do not match." };
  }

  try {
    await changeOwnPassword(session, currentPassword, newPassword);
  } catch (error) {
    if (error instanceof WeakPasswordError || error instanceof PeopleError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect("/");
}
