"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { AuthoringError, addAssessmentCriterion, addCurriculumModule } from "@/lib/authoring";
import {
  addTopic,
  addTopicElement,
  CurriculumError,
  removeCriterion,
  removeModule,
  removeTopic,
  removeTopicElement,
  updateCriterion,
  updateModule,
  updateTopic,
  updateTopicElement,
  type ElementKind,
} from "@/lib/curriculum-editor";
import { PermissionDeniedError } from "@/lib/rbac";

export type EditorState = { error?: string; done?: string };

/**
 * Every action here does the same thing with failure: it hands back the
 * message the library wrote. Those messages name the code that clashed or the
 * work that would be unlinked, which is the whole value — a generic "could not
 * save" would throw that away and leave somebody guessing.
 */
async function run(
  qualificationId: string,
  work: () => Promise<unknown>,
  done: string,
): Promise<EditorState> {
  try {
    await work();
  } catch (error) {
    if (
      error instanceof CurriculumError ||
      error instanceof AuthoringError ||
      error instanceof PermissionDeniedError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/qualifications/${qualificationId}/edit`);
  revalidatePath(`/qualifications/${qualificationId}`);
  return { done };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function optionalNumber(formData: FormData, name: string): number | null {
  const raw = field(formData, name);
  return raw === "" ? null : Number(raw);
}

export async function addModuleAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      addCurriculumModule(session, {
        qualificationId,
        component: field(formData, "component") as
          | "knowledge"
          | "practical"
          | "workplace"
          | "general",
        code: field(formData, "code"),
        title: field(formData, "title"),
        credits: optionalNumber(formData, "credits") ?? undefined,
      }),
    "Module added.",
  );
}

export async function updateModuleAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      updateModule(session, field(formData, "moduleId"), {
        code: field(formData, "code"),
        title: field(formData, "title"),
        credits: optionalNumber(formData, "credits"),
      }),
    "Module saved.",
  );
}

export async function removeModuleAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () => removeModule(session, field(formData, "moduleId")),
    "Module removed.",
  );
}

export async function addTopicAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      addTopic(session, {
        curriculumModuleId: field(formData, "moduleId"),
        code: field(formData, "code"),
        title: field(formData, "title"),
        weightPercent: optionalNumber(formData, "weightPercent"),
      }),
    "Topic added.",
  );
}

export async function updateTopicAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      updateTopic(session, field(formData, "topicId"), {
        code: field(formData, "code"),
        title: field(formData, "title"),
        weightPercent: optionalNumber(formData, "weightPercent"),
      }),
    "Topic saved.",
  );
}

export async function removeTopicAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () => removeTopic(session, field(formData, "topicId")),
    "Topic removed.",
  );
}

export async function addElementAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      addTopicElement(session, {
        topicId: field(formData, "topicId"),
        kind: field(formData, "kind") as ElementKind,
        code: field(formData, "code"),
        description: field(formData, "description"),
      }),
    "Added.",
  );
}

export async function updateElementAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      updateTopicElement(session, field(formData, "elementId"), {
        code: field(formData, "code"),
        description: field(formData, "description"),
      }),
    "Saved.",
  );
}

export async function removeElementAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () => removeTopicElement(session, field(formData, "elementId")),
    "Removed.",
  );
}

export async function addCriterionAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      addAssessmentCriterion(session, {
        curriculumModuleId: field(formData, "moduleId"),
        code: field(formData, "code"),
        description: field(formData, "description"),
      }),
    "Criterion added.",
  );
}

export async function updateCriterionAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () =>
      updateCriterion(session, field(formData, "criterionId"), {
        code: field(formData, "code"),
        description: field(formData, "description"),
      }),
    "Criterion saved.",
  );
}

export async function removeCriterionAction(
  _previous: EditorState,
  formData: FormData,
): Promise<EditorState> {
  const session = await requirePermission("qualification:manage");
  const qualificationId = field(formData, "qualificationId");

  return run(
    qualificationId,
    () => removeCriterion(session, field(formData, "criterionId")),
    "Criterion removed.",
  );
}
