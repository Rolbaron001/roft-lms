"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { IngestError, discardIngest, ingestFolder } from "@/lib/folder-import";
import { commitPlan } from "@/lib/folder-commit";
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
  if (error instanceof IngestError) return { error: error.message };
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
    await ingestFolder(session, path);
  } catch (error) {
    return { ...explain(error), path };
  }

  revalidatePath("/imports");
  return { notice: "Read. What it proposes is below, for you to check." };
}

export async function commitPlanAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const session = await requirePermission("qualification:manage");
  const jobId = field(formData, "jobId");

  let report;
  try {
    report = await commitPlan(session, {
      jobId,
      qualificationId: field(formData, "qualificationId"),
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/imports/${jobId}`);
  revalidatePath("/qualifications");

  const built = [
    `${report.modules} modules`,
    `${report.topics} topics`,
    `${report.elements} elements`,
    `${report.criteria} criteria`,
    `${report.studyUnits} study units`,
    `${report.documents + report.libraryDocuments} documents`,
  ].join(", ");

  // Anything the ordinary guards turned away is said rather than swallowed.
  // A silent partial import is the one outcome nobody could act on.
  const refused =
    report.refused.length > 0
      ? ` ${report.refused.length} ${report.refused.length === 1 ? "thing was" : "things were"} turned away by the usual checks: ${report.refused.slice(0, 8).join(" ")}${report.refused.length > 8 ? ` And ${report.refused.length - 8} more.` : ""}`
      : "";

  return { notice: `Committed: ${built}.${refused}` };
}

export async function discardImportAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const session = await requirePermission("qualification:manage");
  const jobId = field(formData, "jobId");

  try {
    await discardIngest(session, jobId);
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/imports");
  return { notice: "Discarded. The proposal is kept on the record." };
}
