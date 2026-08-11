"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/request";
import {
  addLesson,
  addSection,
  AuthoringError,
  createCourse,
  createNewVersion,
  publishCourse,
  tagCourseCompetency,
  untagCourseCompetency,
} from "@/lib/authoring";
import { PermissionDeniedError } from "@/lib/rbac";

export type ActionState = { error?: string; notice?: string };

/**
 * Turns an exception into a sentence someone can act on. A permission failure
 * and a validation failure are different problems and should not both surface
 * as "something went wrong".
 */
function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof AuthoringError) {
    return error.message;
  }
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { message: string }[] }).issues;
    return issues.map((issue) => issue.message).join(" ");
  }
  console.error(error);
  return "That could not be saved. Please try again.";
}

export async function createCourseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  let courseId: string;

  try {
    const course = await createCourse(session, {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      curriculumModuleId:
        String(formData.get("curriculumModuleId") ?? "") || undefined,
    });
    courseId = course.id;
  } catch (error) {
    return { error: describe(error) };
  }

  redirect(`/courses/${courseId}`);
}

export async function addSectionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");

  try {
    await addSection(session, {
      courseId,
      title: String(formData.get("title") ?? ""),
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}`);
  return { notice: "Section added." };
}

export async function addLessonAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");

  try {
    await addLesson(session, {
      sectionId: String(formData.get("sectionId") ?? ""),
      title: String(formData.get("title") ?? ""),
      contentType: (formData.get("contentType") as "text") || "text",
      body: String(formData.get("body") ?? "") || undefined,
      durationMinutes: formData.get("durationMinutes")
        ? Number(formData.get("durationMinutes"))
        : undefined,
      // Checkboxes share a name; every ticked criterion arrives as an entry.
      criterionIds: formData
        .getAll("criterionIds")
        .map(String)
        .filter(Boolean),
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}`);
  return { notice: "Lesson added." };
}

export async function tagCompetencyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const competencyId = String(formData.get("competencyId") ?? "");

  if (!competencyId) {
    return { error: "Choose a competency first." };
  }

  try {
    await tagCourseCompetency(session, courseId, competencyId);
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}`);
  return { notice: "Competency tagged." };
}

export async function untagCompetencyAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const competencyId = String(formData.get("competencyId") ?? "");

  await untagCourseCompetency(session, courseId, competencyId);
  revalidatePath(`/courses/${courseId}`);
}

export async function publishCourseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");

  try {
    const result = await publishCourse(session, courseId);
    revalidatePath(`/courses/${courseId}`);

    if (!result.ok) {
      return {
        error: `Not ready to publish. ${result.reasons.join(" ")}`,
      };
    }

    return { notice: "Published." };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function newVersionAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  let draftId: string;

  try {
    const draft = await createNewVersion(
      session,
      String(formData.get("courseId") ?? ""),
    );
    draftId = draft.id;
  } catch (error) {
    return { error: describe(error) };
  }

  redirect(`/courses/${draftId}`);
}
