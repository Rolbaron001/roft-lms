"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  acceptLogbook,
  coachSignOff,
  createAgreement,
  openLogbook,
  setEntryCompleted,
  submitToCoach,
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

export async function createAgreementAction(
  _previous: WorkplaceState,
  formData: FormData,
): Promise<WorkplaceState> {
  const session = await requireSession();

  const learnerId = String(formData.get("learnerId") ?? "");
  const coachId = String(formData.get("coachId") ?? "");

  if (!learnerId || !coachId) {
    return { error: "Choose both a learner and a workplace coach." };
  }

  try {
    const agreement = await createAgreement(session, {
      learnerId,
      coachId,
      employerName: String(formData.get("employerName") ?? "").trim(),
      employerAddress:
        String(formData.get("employerAddress") ?? "").trim() || undefined,
      coachDesignation:
        String(formData.get("coachDesignation") ?? "").trim() || undefined,
      startDate: String(formData.get("startDate") ?? "").trim() || undefined,
      endDate: String(formData.get("endDate") ?? "").trim() || undefined,
    });

    revalidatePath("/workplace/setup");
    return {
      message: `Agreement created with ${agreement.coachName} at ${agreement.employerName}.`,
    };
  } catch (error) {
    const described = describe(error);
    if (described) return described;

    // The database trigger is the guarantee behind the application check, and
    // it speaks SQL. Translate rather than showing a stack trace.
    if (String((error as { cause?: unknown }).cause).includes("Segregation")) {
      return { error: "A learner cannot be their own workplace coach." };
    }
    if (error instanceof Error && error.name === "ZodError") {
      return { error: "Fill in the employer's name." };
    }
    throw error;
  }
}

export async function openLogbookAction(
  _previous: WorkplaceState,
  formData: FormData,
): Promise<WorkplaceState> {
  const session = await requireSession();

  const agreementId = String(formData.get("agreementId") ?? "");
  const curriculumModuleId = String(formData.get("curriculumModuleId") ?? "");

  if (!agreementId || !curriculumModuleId) {
    return { error: "Choose an agreement and a work experience module." };
  }

  try {
    await openLogbook(session, agreementId, curriculumModuleId);
    revalidatePath("/workplace");
    revalidatePath("/workplace/setup");
    return { message: "Logbook opened. The learner can start recording." };
  } catch (error) {
    const described = describe(error);
    if (described) return described;

    // One logbook per learner per module, enforced by a unique index.
    if (String((error as { cause?: unknown }).cause).includes("duplicate key")) {
      return {
        error: "That learner already has a logbook open for this module.",
      };
    }
    throw error;
  }
}
