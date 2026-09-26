"use server";

import { revalidatePath } from "next/cache";
import { importStatements, XapiError, type ImportSummary } from "@/lib/xapi";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";

export type ImportState = { error?: string; summary?: ImportSummary };

export async function importStatementsAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose the file of statements to import." };
  }

  try {
    const summary = await importStatements(session, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath("/learning-records");
    return { summary };
  } catch (error) {
    if (error instanceof XapiError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Only a provider administrator may import learning records." };
    }
    throw error;
  }
}
