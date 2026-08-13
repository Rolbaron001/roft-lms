"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  coachSignOff,
  setEntryCompleted,
  submitToCoach,
  acceptLogbook,
  WorkplaceError,
} from "@/lib/workplace";
import { uploadLogbookEvidence, UploadError } from "@/lib/uploads";
import { PermissionDeniedError } from "@/lib/rbac";

export type WorkplaceState = { error?: string; message?: string };

function describe(error: unknown): WorkplaceState | null {
  if (
    error instanceof WorkplaceError ||
    error instanceof UploadError ||
    error instanceof PermissionDeniedError
  ) {
    return { error: error.message };
  }
  return null;
}

export async function tickEntryAction(
  _previous: WorkplaceState,
  formData: FormData,
): Promise<WorkplaceState> {
  const session = await requireSession();
  const entryId = String(formData.get("entryId") ?? "");
  const logbookId = String(formData.get("logbookId") ?? "");
  const completed = formData.get("completed") === "yes";
  const note = String(formData.get("note") ?? "").trim();

  try {
    await setEntryCompleted(session, entryId, completed, note || undefined);
    revalidatePath(`/workplace/${logbookId}`);
    return {};
  } catch (error) {
    return describe(error) ?? { error: "That could not be saved." };
  }
}

export async function uploadEvidenceAction(
  _previous: WorkplaceState,
  formData: FormData,
): Promise<WorkplaceState> {
  const session = await requireSession();
  const entryId = String(formData.get("entryId") ?? "");
  const logbookId = String(formData.get("logbookId") ?? "");
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file." };
  }

  try {
    await uploadLogbookEvidence(session, entryId, [
      { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    ]);
    revalidatePath(`/workplace/${logbookId}`);
    return { message: `${file.name} attached.` };
  } catch (error) {
    return describe(error) ?? { error: "That file could not be attached." };
  }
}

export async function submitLogbookAction(
  _previous: WorkplaceState,
  formData: FormData,
): Promise<WorkplaceState> {
  const session = await requireSession();
  const logbookId = String(formData.get("logbookId") ?? "");
  const hours = Number(formData.get("hours") ?? 0);

  try {
    await submitToCoach(session, logbookId, hours > 0 ? hours : undefined);
    revalidatePath(`/workplace/${logbookId}`);
    return { message: "Sent to your workplace coach." };
  } catch (error) {
    return describe(error) ?? { error: "That could not be submitted." };
  }
}

export async function signOffAction(
  _previous: WorkplaceState,
  formData: FormData,
): Promise<WorkplaceState> {
  const session = await requireSession();
  const logbookId = String(formData.get("logbookId") ?? "");
  const outcome = formData.get("outcome") === "returned" ? "returned" : "signed";
  const comments = String(formData.get("comments") ?? "").trim();

  try {
    await coachSignOff(session, logbookId, {
      outcome,
      comments: comments || undefined,
    });
    revalidatePath(`/workplace/${logbookId}`);
    return {
      message:
        outcome === "signed"
          ? "Signed. It is now with the assessor."
          : "Sent back to the learner.",
    };
  } catch (error) {
    return describe(error) ?? { error: "That could not be recorded." };
  }
}

export async function acceptLogbookAction(
  _previous: WorkplaceState,
  formData: FormData,
): Promise<WorkplaceState> {
  const session = await requireSession();
  const logbookId = String(formData.get("logbookId") ?? "");

  try {
    await acceptLogbook(session, logbookId);
    revalidatePath(`/workplace/${logbookId}`);
    return { message: "Logbook received." };
  } catch (error) {
    return describe(error) ?? { error: "That could not be accepted." };
  }
}
