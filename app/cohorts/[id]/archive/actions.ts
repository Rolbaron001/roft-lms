"use server";

import { revalidatePath } from "next/cache";
import { ArchiveTooLargeError } from "@/lib/archive-writer";
import {
  abandonArchive,
  ArchiveError,
  confirmArchiveCopy,
  finishRestore,
  removeArchivedFiles,
  startCohortArchive,
} from "@/lib/cohort-archive";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";

export type ArchiveActionState = { error?: string; notice?: string };

/** The refusals a person can act on, in their own words; anything else is a fault. */
async function attempt(
  cohortId: string,
  work: () => Promise<string>,
): Promise<ArchiveActionState> {
  try {
    const notice = await work();
    revalidatePath(`/cohorts/${cohortId}/archive`);
    return { notice };
  } catch (error) {
    if (error instanceof ArchiveError || error instanceof ArchiveTooLargeError) {
      revalidatePath(`/cohorts/${cohortId}/archive`);
      return { error: error.message };
    }
    if (error instanceof PermissionDeniedError) {
      return { error: "Only a provider administrator may archive evidence." };
    }
    throw error;
  }
}

export async function startArchiveAction(
  _previous: ArchiveActionState,
  formData: FormData,
): Promise<ArchiveActionState> {
  const session = await requireSession();
  const cohortId = String(formData.get("cohortId") ?? "");
  return attempt(cohortId, async () => {
    await startCohortArchive(session, cohortId);
    return "The archive is being written. This page updates when it is ready to download.";
  });
}

/**
 * The fingerprint arrives from the browser, which took it from the file the
 * provider saved. The file itself never leaves their machine.
 */
export async function confirmCopyAction(
  cohortId: string,
  archiveId: string,
  copy: { fingerprint: string; bytes: number },
): Promise<ArchiveActionState> {
  const session = await requireSession();
  return attempt(cohortId, async () => {
    await confirmArchiveCopy(session, archiveId, copy);
    return "Your copy matches the archive exactly. The files can now be removed from the platform.";
  });
}

export async function removeFilesAction(
  _previous: ArchiveActionState,
  formData: FormData,
): Promise<ArchiveActionState> {
  const session = await requireSession();
  const cohortId = String(formData.get("cohortId") ?? "");
  const archiveId = String(formData.get("archiveId") ?? "");
  return attempt(cohortId, async () => {
    await removeArchivedFiles(session, archiveId);
    return "The files have been removed from the platform. Every record of them remains, and says which archive holds them.";
  });
}

export async function abandonAction(
  _previous: ArchiveActionState,
  formData: FormData,
): Promise<ArchiveActionState> {
  const session = await requireSession();
  const cohortId = String(formData.get("cohortId") ?? "");
  const archiveId = String(formData.get("archiveId") ?? "");
  return attempt(cohortId, async () => {
    await abandonArchive(session, archiveId);
    return "Set aside. Nothing was removed, and its learners can be archived again.";
  });
}

export async function finishRestoreAction(
  cohortId: string,
  archiveId: string,
): Promise<ArchiveActionState> {
  const session = await requireSession();
  return attempt(cohortId, async () => {
    await finishRestore(session, archiveId);
    return "Restored. Every file matched its fingerprint and is back on the platform where it was.";
  });
}
