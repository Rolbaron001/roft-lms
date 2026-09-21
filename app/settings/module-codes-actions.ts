"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  ModuleCodeError,
  setModuleCodeAliases,
} from "@/lib/module-code-settings";

export type ModuleCodesState = { error?: string; saved?: boolean };

/**
 * Confirms this tenant's table of module code spellings.
 *
 * The table arrives as JSON from a page anybody signed in could post to, so
 * none of it is trusted here: the shape is checked, and the rules that stop a
 * spelling meaning two modules are enforced in the library rather than in the
 * form. A browser is where the convenience lives, never the safety.
 */
export async function updateModuleCodesAction(
  _previous: ModuleCodesState,
  formData: FormData,
): Promise<ModuleCodesState> {
  const session = await requirePermission("tenant:manage_settings");

  let table: Record<string, string[]>;
  try {
    const parsed: unknown = JSON.parse(String(formData.get("table") ?? "{}"));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "That table could not be read. Reopen it and try again." };
    }

    table = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(
        ([canonical, aliases]) => [
          String(canonical),
          Array.isArray(aliases) ? aliases.map((one) => String(one)) : [],
        ],
      ),
    );
  } catch {
    return { error: "That table could not be read. Reopen it and try again." };
  }

  try {
    await setModuleCodeAliases(session, table);
  } catch (error) {
    if (error instanceof ModuleCodeError) return { error: error.message };
    throw error;
  }

  revalidatePath("/settings");
  return { saved: true };
}
