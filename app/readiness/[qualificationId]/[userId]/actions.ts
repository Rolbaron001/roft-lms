"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  issueStatementOfResults,
  StatementError,
} from "@/lib/statement-of-results";
import { PermissionDeniedError } from "@/lib/rbac";

export type IssueState = {
  error?: string;
  /** Why it was refused, in the words the engine used. */
  reasons?: string[];
  statementId?: string;
};

export async function issueStatementAction(
  _previous: IssueState,
  formData: FormData,
): Promise<IssueState> {
  const session = await requireSession();
  const qualificationId = String(formData.get("qualificationId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  try {
    const result = await issueStatementOfResults(session, qualificationId, userId);

    if (!result.ok) {
      return { reasons: result.reasons };
    }

    revalidatePath(`/readiness/${qualificationId}/${userId}`);
    return { statementId: result.statementId };
  } catch (error) {
    if (error instanceof StatementError) {
      return { error: error.message };
    }
    if (error instanceof PermissionDeniedError) {
      return { error: "Issuing a Statement of Results is limited to staff who can issue certificates." };
    }
    throw error;
  }
}
