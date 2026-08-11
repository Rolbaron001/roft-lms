"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/request";
import {
  addCourseToPath,
  createLearningPath,
  enrolOnPath,
  LearningPathError,
  moveCourseInPath,
  publishLearningPath,
  removeCourseFromPath,
} from "@/lib/learning-paths";
import { PermissionDeniedError } from "@/lib/rbac";

export type PathState = { error?: string; notice?: string };

function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof LearningPathError) {
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

export async function createPathAction(
  _previous: PathState,
  formData: FormData,
): Promise<PathState> {
  const session = await requireSession();
  let pathId: string;

  try {
    const created = await createLearningPath(session, {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
    });
    pathId = created.id;
  } catch (error) {
    return { error: describe(error) };
  }

  redirect(`/paths/${pathId}`);
}

export async function addCourseAction(
  _previous: PathState,
  formData: FormData,
): Promise<PathState> {
  const session = await requireSession();
  const pathId = String(formData.get("pathId") ?? "");
  const courseId = String(formData.get("courseId") ?? "");

  if (!courseId) {
    return { error: "Choose a course to add." };
  }

  try {
    await addCourseToPath(
      session,
      pathId,
      courseId,
      formData.get("requiresPrevious") === "on",
    );
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/paths/${pathId}`);
  return { notice: "Added." };
}

export async function removeCourseAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const pathId = String(formData.get("pathId") ?? "");

  await removeCourseFromPath(
    session,
    pathId,
    String(formData.get("courseId") ?? ""),
  );

  revalidatePath(`/paths/${pathId}`);
}

export async function moveCourseAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const pathId = String(formData.get("pathId") ?? "");

  await moveCourseInPath(
    session,
    pathId,
    String(formData.get("courseId") ?? ""),
    formData.get("direction") === "up" ? "up" : "down",
  );

  revalidatePath(`/paths/${pathId}`);
}

export async function publishPathAction(
  _previous: PathState,
  formData: FormData,
): Promise<PathState> {
  const session = await requireSession();
  const pathId = String(formData.get("pathId") ?? "");

  try {
    const result = await publishLearningPath(session, pathId);
    revalidatePath(`/paths/${pathId}`);

    if (!result.ok) {
      return { error: `Not ready to publish. ${result.reasons.join(" ")}` };
    }

    return { notice: "Published. It can be assigned now." };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function enrolOnPathAction(
  _previous: PathState,
  formData: FormData,
): Promise<PathState> {
  const session = await requireSession();
  const pathId = String(formData.get("pathId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");

  if (!userId) {
    return { error: "Choose somebody to put on the programme." };
  }

  try {
    await enrolOnPath(session, userId, pathId, dueDate || undefined);
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/paths/${pathId}`);
  return { notice: "Added to the programme. Their first course is open now." };
}
