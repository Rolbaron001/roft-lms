"use server";

import { revalidatePath } from "next/cache";
import {
  EnrolmentFormError,
  saveEnrolmentForm,
  type EnrolmentFormInput,
} from "@/lib/enrolment-form";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";

export type FormState = { error?: string; notice?: string };

/** Every text field on the form, read off the posted data by name. */
const TEXT_FIELDS = [
  "title",
  "middleName",
  "alternateId",
  "alternateIdType",
  "homeLanguageCode",
  "citizenResidentStatusCode",
  "socioeconomicStatusCode",
  "disabilityRating",
  "immigrantStatus",
  "homeAddress1",
  "homeAddress2",
  "homeAddress3",
  "homeAddressPostalCode",
  "postalAddress1",
  "postalAddress2",
  "postalAddress3",
  "postalAddressPostalCode",
  "phoneNumber",
  "cellPhoneNumber",
  "faxNumber",
  "provinceCode",
  "statssaAreaCode",
  "flc",
  "flcStatementNumber",
  "employerName",
] as const;

export async function saveEnrolmentFormAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await requireSession();

  // Whose form. A learner may only send their own; the library enforces it, so
  // this is a convenience rather than the guard.
  const learnerId = String(formData.get("learnerId") ?? "") || session.userId;
  const confirm = formData.get("intent") === "confirm";

  const input: EnrolmentFormInput = {};
  for (const field of TEXT_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") {
      (input as Record<string, string>)[field] = value;
    }
  }
  input.popiaAgreed = formData.get("popiaAgreed") === "on";

  try {
    await saveEnrolmentForm(session, learnerId, input, { confirm });
  } catch (error) {
    if (error instanceof EnrolmentFormError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    throw error;
  }

  revalidatePath("/enrolment-form");

  return {
    notice: confirm
      ? "Confirmed, and the date recorded. Change anything here later and it will ask you to confirm again."
      : "Saved. You can come back and finish it later.",
  };
}
