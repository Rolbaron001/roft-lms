"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import { RegistrationError, recordEisaSitting } from "@/lib/eisa-registration";
import { PermissionDeniedError } from "@/lib/rbac";

export type EisaActionState = { error?: string; notice?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function recordSittingAction(
  _previous: EisaActionState,
  formData: FormData,
): Promise<EisaActionState> {
  const session = await requirePermission("enrolment:manage");

  try {
    await recordEisaSitting(session, {
      name: field(formData, "name"),
      sittingDate: field(formData, "sittingDate"),
      registrationCloses: field(formData, "registrationCloses"),
      assessmentQualityPartner:
        field(formData, "assessmentQualityPartner") || undefined,
      note: field(formData, "note") || undefined,
    });
  } catch (error) {
    if (error instanceof RegistrationError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    if (error && typeof error === "object" && "issues" in error) {
      return {
        error: (error as { issues: { message: string }[] }).issues
          .map((issue) => issue.message)
          .join(" "),
      };
    }
    console.error(error);
    return { error: "That could not be saved. Please try again." };
  }

  revalidatePath("/eisa");
  return { notice: "Recorded. The countdown to registration starts now." };
}
