"use server";

import { revalidatePath } from "next/cache";
import { requireSession, said } from "@/lib/request";
import { assignStaff, removeStaff, setCohortFacilitator, StaffError } from "@/lib/programme-staff";
import { PermissionDeniedError } from "@/lib/rbac";

export type StaffState = { error?: string; done?: string };

function field(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) ?? "").trim();
  return value || undefined;
}

function explain(error: unknown): StaffState {
  if (error instanceof StaffError) return { error: error.message };
  if (error instanceof PermissionDeniedError) return { error: "Your role does not allow that." };
  if (error && typeof error === "object" && "issues" in error) {
    return { error: (error as { issues: { message: string }[] }).issues.map((issue) => issue.message).join(" ") };
  }
  throw error;
}

/** Names a person on a programme (job sheet D27). */
export async function assignStaffAction(_previous: StaffState, formData: FormData): Promise<StaffState> {
  const session = await requireSession();
  try {
    await assignStaff(session, {
      userId: field(formData, "userId") ?? "",
      capacity: (field(formData, "capacity") ?? "facilitator") as "facilitator",
      qualificationId: field(formData, "qualificationId"),
      studyUnitId: field(formData, "studyUnitId"),
      courseId: field(formData, "courseId"),
      learningPathId: field(formData, "learningPathId"),
      registrationNumber: field(formData, "registrationNumber"),
      registrationExpiresOn: field(formData, "registrationExpiresOn"),
    });
  } catch (error) {
    return said(explain(error));
  }
  revalidatePath(field(formData, "path") ?? "/");
  return said({ done: "Named." });
}

/** A cohort's facilitator, chosen or changed on the cohort page (D27). */
export async function setCohortFacilitatorAction(_previous: StaffState, formData: FormData): Promise<StaffState> {
  const session = await requireSession();
  const cohortId = field(formData, "cohortId") ?? "";
  try {
    await setCohortFacilitator(session, cohortId, field(formData, "facilitatorId") ?? null);
  } catch (error) {
    return said(explain(error));
  }
  revalidatePath(`/cohorts/${cohortId}`);
  return said({ done: "Saved." });
}

export async function removeStaffAction(_previous: StaffState, formData: FormData): Promise<StaffState> {
  const session = await requireSession();
  try {
    await removeStaff(session, field(formData, "id") ?? "");
  } catch (error) {
    return said(explain(error));
  }
  revalidatePath(field(formData, "path") ?? "/");
  return said({ done: "Removed." });
}
