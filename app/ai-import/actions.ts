"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { ImportError, discardImport, importFromFolder } from "@/lib/ai-import";
import { commitProposedModule } from "@/lib/ai-import-commit";
import { PermissionDeniedError } from "@/lib/rbac";

export type ImportActionState = {
  error?: string;
  notice?: string;
  path?: string;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function explain(error: unknown): ImportActionState {
  if (error instanceof ImportError) return { error: error.message };
  if (error instanceof PermissionDeniedError) {
    return { error: "Your role does not allow that." };
  }
  console.error(error);
  return {
    error:
      error instanceof Error
        ? error.message
        : "That could not be done. Please try again.",
  };
}

/**
 * Reading a folder.
 *
 * Slow by nature - a model reading a curriculum document takes minutes, not
 * seconds - so the form says so rather than looking as though it has hung.
 */
export async function readFolderAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const session = await requirePermission("qualification:manage");
  const path = field(formData, "path");

  try {
    await importFromFolder(session, path);
  } catch (error) {
    return { ...explain(error), path };
  }

  revalidatePath("/ai-import");
  return { notice: "Read. What it proposes is below, for you to check." };
}

export async function commitModuleAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const session = await requirePermission("qualification:manage");
  const jobId = field(formData, "jobId");

  let summary;
  try {
    summary = await commitProposedModule(session, {
      jobId,
      qualificationId: field(formData, "qualificationId"),
      moduleCode: field(formData, "moduleCode"),
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/ai-import/${jobId}`);
  revalidatePath("/qualifications");

  const refused =
    summary.refused.length > 0
      ? ` ${summary.refused.length} thing${summary.refused.length === 1 ? "" : "s"} were turned away by the ordinary checks: ${summary.refused.join(" ")}`
      : "";

  return {
    notice: `${summary.moduleCode} added: ${summary.topics} topics, ${summary.elements} elements, ${summary.criteria} criteria.${refused}`,
  };
}

export async function discardImportAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const session = await requirePermission("qualification:manage");
  const jobId = field(formData, "jobId");

  try {
    await discardImport(session, jobId);
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/ai-import");
  return { notice: "Discarded. The proposal is kept on the record." };
}
