"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { revokeStatementOfResults } from "@/lib/statement-of-results";
import { PermissionDeniedError } from "@/lib/rbac";

export type WithdrawState = { error?: string; notice?: string };

/**
 * Withdrawing a Statement of Results.
 *
 * The reason is required and it is not paperwork. An assessment centre may
 * already hold a copy of this document, and somebody will eventually ask
 * whether it is still valid; "withdrawn on this date because the workplace
 * logbook was signed in error" is an answer, and a bare "withdrawn" is not.
 *
 * Nothing is deleted. The statement keeps its reference and its verification
 * page keeps working, saying plainly that it was withdrawn.
 */
export async function withdrawStatementAction(
  _previous: WithdrawState,
  formData: FormData,
): Promise<WithdrawState> {
  const session = await requireSession();
  const id = String(formData.get("statementId") ?? "");

  try {
    await revokeStatementOfResults(
      session,
      id,
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error:
          "Your role does not include withdrawing a Statement of Results.",
      };
    }
    return {
      error:
        error instanceof Error ? error.message : "That could not be withdrawn.",
    };
  }

  revalidatePath(`/statements/${id}`);
  revalidatePath("/readiness");
  return { notice: "Withdrawn. The reference still resolves, and says so." };
}
