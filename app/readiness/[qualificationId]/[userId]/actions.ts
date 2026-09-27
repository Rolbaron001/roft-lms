"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  issueStatementOfResults,
  StatementError,
} from "@/lib/statement-of-results";
import { PermissionDeniedError } from "@/lib/rbac";
import {
  AwardError,
  recordQualificationAward,
  removeQualificationAward,
} from "@/lib/qualification-awards";

export type AwardState = { error?: string; notice?: string };

function awardProblem(error: unknown): string {
  if (error instanceof AwardError) return error.message;
  if (error instanceof PermissionDeniedError) {
    return "Recording a qualification certificate is limited to staff who manage enrolments.";
  }
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: { message: string }[] }).issues.map((i) => i.message).join(" ");
  }
  throw error;
}

export async function recordAwardAction(
  _previous: AwardState,
  formData: FormData,
): Promise<AwardState> {
  const session = await requireSession();
  const qualificationId = String(formData.get("qualificationId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  try {
    await recordQualificationAward(session, {
      userId,
      qualificationId,
      certificateNumber: String(formData.get("certificateNumber") ?? ""),
      awardedOn: String(formData.get("awardedOn") ?? ""),
      awardedBy: String(formData.get("awardedBy") ?? "") || undefined,
      note: String(formData.get("note") ?? "") || undefined,
    });
  } catch (error) {
    return { error: awardProblem(error) };
  }

  revalidatePath(`/readiness/${qualificationId}/${userId}`);
  revalidatePath(`/people/${userId}`);
  return { notice: "Recorded." };
}

export async function removeAwardAction(
  _previous: AwardState,
  formData: FormData,
): Promise<AwardState> {
  const session = await requireSession();
  const qualificationId = String(formData.get("qualificationId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  try {
    await removeQualificationAward(
      session,
      String(formData.get("awardId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    return { error: awardProblem(error) };
  }

  revalidatePath(`/readiness/${qualificationId}/${userId}`);
  revalidatePath(`/people/${userId}`);
  return { notice: "Removed." };
}

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
  // Absent for the whole-qualification statement.
  const studyUnitId = String(formData.get("studyUnitId") ?? "") || null;

  try {
    const result = await issueStatementOfResults(
      session,
      qualificationId,
      userId,
      studyUnitId,
    );

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
