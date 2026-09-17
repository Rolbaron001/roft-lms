"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  accessTokenFor,
  connectionsFor,
  DriveError,
  type DriveProviderName,
} from "@/lib/drive";
import { importFromDrive } from "@/lib/drive/import";
import { IngestError } from "@/lib/folder-import";
import { PermissionDeniedError } from "@/lib/rbac";

export type DriveBrowseState = {
  error?: string;
  /** Where we are, innermost last, so a trail can be drawn. */
  trail?: { id: string; name: string }[];
  folders?: { id: string; name: string }[];
};

export type DriveImportState = {
  error?: string;
  notice?: string;
  jobId?: string;
};

function explain(error: unknown): string {
  if (error instanceof DriveError) return error.message;
  if (error instanceof IngestError) return error.message;
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  console.error(error);
  return error instanceof Error
    ? error.message
    : "That could not be done. Please try again.";
}

/**
 * The folders inside another, for choosing one.
 *
 * A drill-down rather than a search box. A provider's material sits in a
 * folder somebody already knows the way to, and typing a name reliably finds
 * the wrong "121151" in a drive that has three.
 */
export async function browseDriveAction(
  _previous: DriveBrowseState,
  formData: FormData,
): Promise<DriveBrowseState> {
  const session = await requirePermission("qualification:manage");

  const providerName = String(formData.get("provider") ?? "");
  const parentId = String(formData.get("parentId") ?? "") || undefined;

  let trail: { id: string; name: string }[] = [];
  try {
    trail = JSON.parse(String(formData.get("trail") ?? "[]"));
  } catch {
    trail = [];
  }

  try {
    const { provider, accessToken } = await accessTokenFor(
      session,
      providerName as DriveProviderName,
    );

    const folders = await provider.folders({ accessToken, parentId });

    return { trail, folders };
  } catch (error) {
    return { error: explain(error), trail };
  }
}

/**
 * Reading the chosen folder.
 *
 * Ends where an uploaded folder ends — at a proposal somebody checks before
 * anything is written. A drive is a different way of getting the files, not a
 * different kind of import, and it would be a poor trade to skip the check
 * because the files arrived by a different road.
 */
export async function importFromDriveAction(
  _previous: DriveImportState,
  formData: FormData,
): Promise<DriveImportState> {
  const session = await requirePermission("qualification:manage");

  const providerName = String(formData.get("provider") ?? "");
  const folderId = String(formData.get("folderId") ?? "");
  const folderName = String(formData.get("folderName") ?? "a folder");

  if (!folderId) return { error: "Choose a folder first." };

  const qualificationId = String(formData.get("qualificationId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");
  const learningPathId = String(formData.get("learningPathId") ?? "");
  const topUp = String(formData.get("topUp") ?? "") === "yes";

  const mode = courseId
    ? "course"
    : learningPathId
      ? "programme"
      : qualificationId
        ? topUp
          ? "top_up"
          : "material"
        : "qualification";

  try {
    const job = await importFromDrive(session, {
      provider: providerName as DriveProviderName,
      folderId,
      folderName,
      mode,
      qualificationId: qualificationId || undefined,
      courseId: courseId || undefined,
      learningPathId: learningPathId || undefined,
    });

    revalidatePath("/imports");

    if (job.status !== "proposed") {
      return { error: job.error ?? "That folder could not be read." };
    }

    return {
      notice: "Read. Check what it found before committing any of it.",
      jobId: job.id,
    };
  } catch (error) {
    return { error: explain(error) };
  }
}

/** Which of this person's drives are connected, for a screen. */
export async function connectedDrives(): Promise<
  { provider: string; label: string; accountLabel: string | null }[]
> {
  const session = await requirePermission("qualification:manage");
  const rows = await connectionsFor(session);
  return rows.map((one) => ({
    provider: one.provider,
    label: one.label,
    accountLabel: one.accountLabel,
  }));
}
