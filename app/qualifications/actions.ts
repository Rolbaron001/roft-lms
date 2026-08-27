"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createQualificationFromDocuments,
  QualificationImportError,
  readQualificationSources,
  type DocumentReading,
  type SourceDocuments,
} from "@/lib/qualification-from-document";
import { requirePermission, requireSession } from "@/lib/request";
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
      curriculumCode: String(formData.get("curriculumCode") ?? "") || undefined,
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

export type ReadingState = {
  error?: string;
  reading?: DocumentReading;
};

/**
 * Reads an uploaded curriculum document and hands back what it found.
 *
 * Writes nothing. The file goes back up again on the confirm step rather than
 * being parked somewhere between the two — a half-finished import sitting in a
 * table waiting for somebody to come back to it is a state worth not having.
 */
/**
 * Pulls the three documents off the form.
 *
 * Only the curriculum is required. The other two are how the SAQA ID, the Exit
 * Level Outcomes and the assessment specification get in, so a reading without
 * them says so rather than quietly producing less.
 */
async function sourcesFrom(
  formData: FormData,
): Promise<SourceDocuments | { error: string }> {
  async function take(name: string) {
    const file = formData.get(name);
    if (!(file instanceof File) || file.size === 0) return null;
    return {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }

  const curriculum = await take("curriculum");
  if (!curriculum) {
    return { error: "Choose the Curriculum Document — it is the one that states the modules." };
  }

  return {
    curriculum,
    qualification: await take("qualification"),
    assessmentSpecification: await take("assessmentSpecification"),
  };
}

export async function readCurriculumAction(
  _previous: ReadingState,
  formData: FormData,
): Promise<ReadingState> {
  const session = await requirePermission("qualification:manage");

  const sources = await sourcesFrom(formData);
  if ("error" in sources) return { error: sources.error };

  try {
    return { reading: await readQualificationSources(session, sources) };
  } catch (error) {
    if (error instanceof QualificationImportError) {
      return { error: error.message };
    }
    return { error: describe(error) };
  }
}

export type CreateFromDocumentState = {
  error?: string;
  warnings?: string[];
};

export async function createFromDocumentAction(
  _previous: CreateFromDocumentState,
  formData: FormData,
): Promise<CreateFromDocumentState> {
  const session = await requirePermission("qualification:manage");

  const sources = await sourcesFrom(formData);
  if ("error" in sources) {
    return { error: "The documents were not sent with the form. Choose them again." };
  }

  let created: { qualificationId: string };

  try {
    created = await createQualificationFromDocuments(session, sources, {
      title: String(formData.get("title") ?? ""),
      curriculumCode: String(formData.get("curriculumCode") ?? "") || undefined,
      saqaId: String(formData.get("saqaId") ?? "") || undefined,
      nqfLevel: formData.get("nqfLevel")
        ? Number(formData.get("nqfLevel"))
        : undefined,
      totalCredits: formData.get("totalCredits")
        ? Number(formData.get("totalCredits"))
        : undefined,
    });
  } catch (error) {
    if (error instanceof QualificationImportError) {
      return { error: error.message };
    }
    return { error: describe(error) };
  }

  revalidatePath("/qualifications");
  // Straight to the qualification, which is what there is to check.
  redirect(`/qualifications/${created.qualificationId}`);
}
