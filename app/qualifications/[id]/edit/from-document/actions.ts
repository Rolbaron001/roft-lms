"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { AuthoringError } from "@/lib/authoring";
import {
  acceptProposedModule,
  CurriculumImportError,
  type AcceptedSummary,
} from "@/lib/curriculum-from-document";
import { CurriculumError } from "@/lib/curriculum-editor";
import { PermissionDeniedError } from "@/lib/rbac";

export type AcceptState = { error?: string; done?: AcceptedSummary };

export async function acceptModuleAction(
  _previous: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = String(formData.get("qualificationId") ?? "");
  const moduleCode = String(formData.get("moduleCode") ?? "");

  let done: AcceptedSummary;

  try {
    done = await acceptProposedModule(session, qualificationId, moduleCode);
  } catch (error) {
    if (
      error instanceof CurriculumImportError ||
      error instanceof CurriculumError ||
      error instanceof AuthoringError ||
      error instanceof PermissionDeniedError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/qualifications/${qualificationId}/edit/from-document`);
  revalidatePath(`/qualifications/${qualificationId}/edit`);
  revalidatePath(`/qualifications/${qualificationId}`);

  return { done };
}
