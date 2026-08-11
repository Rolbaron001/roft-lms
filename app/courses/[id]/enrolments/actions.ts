"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { bulkEnrol, EnrolmentError, enrolUser } from "@/lib/enrolment";
import { PermissionDeniedError } from "@/lib/rbac";

export type EnrolState = { error?: string; notice?: string };

function describe(error: unknown): string {
  if (error instanceof PermissionDeniedError) {
    return "Your role does not allow that.";
  }
  if (error instanceof EnrolmentError) {
    return error.message;
  }
  console.error(error);
  return "That could not be saved. Please try again.";
}

export async function enrolOneAction(
  _previous: EnrolState,
  formData: FormData,
): Promise<EnrolState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");

  if (!userId) {
    return { error: "Choose someone to enrol." };
  }

  try {
    await enrolUser(session, {
      courseId,
      userId,
      dueDate: dueDate || undefined,
    });
  } catch (error) {
    return { error: describe(error) };
  }

  revalidatePath(`/courses/${courseId}/enrolments`);
  return { notice: "Enrolled." };
}

export async function bulkEnrolAction(
  _previous: EnrolState,
  formData: FormData,
): Promise<EnrolState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  const dueDate = String(formData.get("dueDate") ?? "");

  // One address per line, or comma-separated, so a column pasted straight out
  // of a spreadsheet works without reformatting.
  const emails = String(formData.get("emails") ?? "")
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    return { error: "Paste at least one email address." };
  }

  try {
    const result = await bulkEnrol(
      session,
      courseId,
      emails,
      dueDate || undefined,
    );

    const parts: string[] = [];
    if (result.enrolled.length > 0) {
      parts.push(`${result.enrolled.length} enrolled.`);
    }
    if (result.alreadyEnrolled.length > 0) {
      parts.push(
        `${result.alreadyEnrolled.length} already on the course: ${result.alreadyEnrolled.join(", ")}.`,
      );
    }
    if (result.unknown.length > 0) {
      parts.push(
        `${result.unknown.length} not recognised: ${result.unknown.join(", ")}.`,
      );
    }

    revalidatePath(`/courses/${courseId}/enrolments`);

    // An unrecognised address is a problem the person needs to fix, so it is
    // reported as an error even when other addresses were enrolled fine.
    return result.unknown.length > 0
      ? { error: parts.join(" ") }
      : { notice: parts.join(" ") || "Nothing to do." };
  } catch (error) {
    return { error: describe(error) };
  }
}
