"use server";

import { revalidatePath } from "next/cache";
import { requireSession, said } from "@/lib/request";
import { revokeCertificate } from "@/lib/certificates";
import { PermissionDeniedError } from "@/lib/rbac";

export type WithdrawState = { error?: string; notice?: string };

/**
 * Withdrawing a certificate.
 *
 * Kept and marked withdrawn rather than deleted. Somebody holds the reference -
 * an employer checking it, a learner who put it on an application - and a
 * certificate that simply stops existing looks like a fault in the platform
 * rather than a decision somebody took.
 *
 * The reason is required for the same purpose it is required on a disposal: it
 * is the whole of the record of why.
 */
export async function withdrawCertificateAction(
  _previous: WithdrawState,
  formData: FormData,
): Promise<WithdrawState> {
  const session = await requireSession();
  const id = String(formData.get("certificateId") ?? "");

  try {
    await revokeCertificate(session, id, String(formData.get("reason") ?? ""));
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return said({ error: "Your role does not include withdrawing a certificate." });
    }
    return said({
      error:
        error instanceof Error ? error.message : "That could not be withdrawn.",
    });
  }

  revalidatePath(`/certificates/${id}`);
  return said({ notice: "Withdrawn. Anyone checking the reference is now told so." });
}
