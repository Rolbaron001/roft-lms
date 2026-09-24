"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { PermissionDeniedError } from "@/lib/rbac";
import {
  SpineError,
  addPrerequisite,
  addStep,
  removeStep,
  reorderSteps,
  type PrerequisiteRule,
  type StepKind,
} from "@/lib/spine";

export type SpineState = { error?: string; notice?: string };

function describe(error: unknown): string {
  if (error instanceof SpineError) return error.message;
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  throw error;
}

/**
 * Putting something on a learner's path.
 *
 * Every refusal worth making is already in lib/spine.ts: a step that names
 * nothing, a gate that could never open, a prerequisite pointing forwards or
 * round in a circle. These actions add none of their own, so the screen and
 * anything else calling the library behave the same way.
 */
export async function addStepAction(
  _previous: SpineState,
  formData: FormData,
): Promise<SpineState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const kind = String(formData.get("kind") ?? "") as StepKind;
  const targetId = String(formData.get("targetId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const guidance = String(formData.get("guidance") ?? "").trim();

  if (!targetId) {
    return { error: "Choose what the step points at." };
  }

  try {
    await addStep(session, {
      courseId,
      kind,
      lessonId: kind === "lesson" ? targetId : undefined,
      assessmentId: kind === "assessment" ? targetId : undefined,
      programmeDocumentId: kind === "document" ? targetId : undefined,
      curriculumModuleId: kind === "workplace" ? targetId : undefined,
      title: title || undefined,
      guidance: guidance || undefined,
      release: formData.get("release") === "open" ? "open" : "sequential",
      sequentialRule:
        (String(formData.get("sequentialRule") ?? "") as PrerequisiteRule) ||
        undefined,
      optional: formData.get("optional") === "on",
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/steps`);
  return { notice: "Added to the end of the list." };
}

export async function removeStepAction(
  _previous: SpineState,
  formData: FormData,
): Promise<SpineState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");

  try {
    await removeStep(session, String(formData.get("stepId") ?? ""));
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/steps`);
  return { notice: "Taken off the list. What it pointed at is untouched." };
}

/**
 * Moving one step up or down.
 *
 * The library takes the whole order at once and refuses anything that is not
 * every step exactly once, which is what stops a half-applied reorder. The
 * screen sends a complete list; this only works out what swapping two makes
 * it.
 */
export async function moveStepAction(
  _previous: SpineState,
  formData: FormData,
): Promise<SpineState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const stepId = String(formData.get("stepId") ?? "");
  const direction = formData.get("direction") === "up" ? -1 : 1;
  const order = String(formData.get("order") ?? "").split(",").filter(Boolean);

  const at = order.indexOf(stepId);
  const to = at + direction;

  if (at === -1 || to < 0 || to >= order.length) {
    return { error: "That step cannot move any further." };
  }

  [order[at], order[to]] = [order[to], order[at]];

  try {
    await reorderSteps(session, courseId, order);
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/steps`);
  return { notice: "Moved." };
}

export async function addPrerequisiteAction(
  _previous: SpineState,
  formData: FormData,
): Promise<SpineState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const requiredStepId = String(formData.get("requiredStepId") ?? "");

  if (!requiredStepId) return { error: "Choose the step that comes first." };

  try {
    await addPrerequisite(session, {
      stepId: String(formData.get("stepId") ?? ""),
      requiredStepId,
      rule: String(formData.get("rule") ?? "opened") as PrerequisiteRule,
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/steps`);
  return { notice: "Added." };
}
