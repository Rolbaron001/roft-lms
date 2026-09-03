"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { IngestError, discardIngest, ingestUpload } from "@/lib/folder-import";
import { commitPlan } from "@/lib/folder-commit";
import { PermissionDeniedError } from "@/lib/rbac";

export type ImportActionState = {
  error?: string;
  notice?: string;
  path?: string;
  /** Set once a folder has been read, so the form can link straight to it. */
  jobId?: string;
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
/**
 * Reading a folder the browser has handed over.
 *
 * The files arrive as an upload rather than a path on the server, so there is
 * nothing to register anywhere and nothing to restrict: a person offers what
 * they can already open, exactly as they would attaching a single document.
 */
export async function readFolderAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const session = await requirePermission("qualification:manage");

  const entries = formData.getAll("files").filter(
    (entry): entry is File => entry instanceof File,
  );

  if (entries.length === 0) {
    return { error: "Choose a folder." };
  }

  // Material goes against a qualification that already exists, so the mode and
  // the qualification travel together or not at all.
  const qualificationId = field(formData, "qualificationId");
  const mode = qualificationId ? "material" : "qualification";

  // The paths are posted as a parallel list rather than keyed by filename: a
  // programme folder has "121151 SU1 Theory Guide.docx" in one place and a
  // memorandum of the same name in another, and keying by the last segment
  // would file one of them where the other belongs. FormData keeps the order
  // it was appended in, so the two lists line up.
  const paths = formData.getAll("paths").map(String);

  if (paths.length !== entries.length) {
    return {
      error:
        "The files and their folder paths did not arrive together. Try again.",
    };
  }

  const incoming = await Promise.all(
    entries.map(async (entry, index) => ({
      path: paths[index] || entry.name,
      bytes: new Uint8Array(await entry.arrayBuffer()),
    })),
  );

  const folderName = field(formData, "folderName") || "an uploaded folder";

  let job;
  try {
    job = await ingestUpload(session, incoming, mode, folderName);
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/imports");

  if (job.status !== "proposed") {
    return { error: job.error ?? "That folder could not be read." };
  }

  return {
    notice: "Read. Check what it found before committing any of it.",
    jobId: job.id,
  };
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
