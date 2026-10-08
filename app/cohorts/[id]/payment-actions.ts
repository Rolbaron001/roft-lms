"use server";

import { revalidatePath } from "next/cache";
import { DocumentError, recordCohortPayment } from "@/lib/enrolment-documents";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession, said } from "@/lib/request";

export type PaymentState = { error?: string; notice?: string };

/**
 * Records that a client was invoiced for a cohort, and then that they paid.
 *
 * The opening step of Curiosa's enrolment procedure, and the one the platform
 * had no idea about until 15 September.
 */
export async function recordPaymentAction(
  _previous: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const session = await requireSession();
  const cohortId = String(formData.get("cohortId") ?? "");

  const invoicedOn = String(formData.get("invoicedOn") ?? "").trim();
  const receivedOn = String(formData.get("receivedOn") ?? "").trim();
  const reference = String(formData.get("reference") ?? "");

  try {
    await recordCohortPayment(session, cohortId, {
      invoicedOn: invoicedOn || undefined,
      receivedOn: receivedOn || undefined,
      reference,
    });
  } catch (error) {
    if (error instanceof DocumentError) return said({ error: error.message });
    if (error instanceof PermissionDeniedError) {
      return said({ error: "Your role does not allow that." });
    }
    throw error;
  }

  revalidatePath(`/cohorts/${cohortId}`);

  return said({
    notice: receivedOn
      ? "Recorded. Every learner in this cohort is now treated as paid for."
      : "Invoice recorded. Add the payment date when it comes in.",
  });
}
