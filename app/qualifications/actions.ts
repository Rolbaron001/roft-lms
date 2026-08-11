"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  AuthoringError,
  createQualification,
} from "@/lib/authoring";
import { PermissionDeniedError } from "@/lib/rbac";
import type { ActionState } from "../courses/actions";

export type { ActionState };

function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof AuthoringError) {
    return error.message;
  }
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: { message: string }[] }).issues
      .map((issue) => issue.message)
      .join(" ");
  }
  console.error(error);
  return "That could not be saved. Please try again.";
}

export async function createQualificationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  try {
    await createQualification(session, {
      title: String(formData.get("title") ?? ""),
      qctoCode: String(formData.get("qctoCode") ?? "") || undefined,
      saqaId: String(formData.get("saqaId") ?? "") || undefined,
      nqfLevel: formData.get("nqfLevel")
        ? Number(formData.get("nqfLevel"))
        : undefined,
      totalCredits: formData.get("totalCredits")
        ? Number(formData.get("totalCredits"))
        : undefined,
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/qualifications");
  return { notice: "Qualification created." };
}

export async function addModuleAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  try {
    await addCurriculumModule(session, {
      qualificationId: String(formData.get("qualificationId") ?? ""),
      component: formData.get("component") as "knowledge",
      code: String(formData.get("code") ?? ""),
      title: String(formData.get("title") ?? ""),
      credits: formData.get("credits")
        ? Number(formData.get("credits"))
        : undefined,
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/qualifications");
  return { notice: "Module added." };
}

export async function addCriterionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  try {
    await addAssessmentCriterion(session, {
      curriculumModuleId: String(formData.get("curriculumModuleId") ?? ""),
      code: String(formData.get("code") ?? ""),
      description: String(formData.get("description") ?? ""),
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath("/qualifications");
  return { notice: "Assessment criterion added." };
}
