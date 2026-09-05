"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import {
  moderateRplJudgement,
  openRplApplication,
  recordAdvisory,
  recordCreditTransfer,
  recordRplJudgement,
} from "@/lib/recognition";
import { PermissionDeniedError } from "@/lib/rbac";

export type RecognitionState = {
  error?: string;
  notice?: string;
  values?: Record<string, string>;
  attempt?: number;
};

/**
 * The Recognition of Prior Learning screens.
 *
 * Every one of these refuses rather than warns, and the refusals come from the
 * library rather than from here - a rationale under thirty characters, an
 * exemption that would take a learner past the tenant's ceiling, a judgement
 * moderated by the person who made it. This file's only job is to turn a form
 * into a call and a thrown error into something a person can act on.
 */
function fail(
  previous: RecognitionState,
  error: unknown,
  values: Record<string, string>,
): RecognitionState {
  if (error instanceof PermissionDeniedError) {
    return {
      error:
        "Your role does not include this. Recognition is held by the provider's own staff, and a judgement is moderated by somebody other than whoever made it.",
      values,
      attempt: (previous.attempt ?? 0) + 1,
    };
  }

  return {
    error:
      error instanceof Error ? error.message : "That could not be recorded.",
    values,
    attempt: (previous.attempt ?? 0) + 1,
  };
}

function fields(formData: FormData, names: string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => [name, String(formData.get(name) ?? "")]),
  );
}

export async function openApplicationAction(
  previous: RecognitionState,
  formData: FormData,
): Promise<RecognitionState> {
  const session = await requireSession();
  const values = fields(formData, ["learnerId", "qualificationId", "appliedOn"]);

  try {
    await openRplApplication(session, values as never);
  } catch (error) {
    return fail(previous, error, values);
  }

  revalidatePath("/recognition");
  return { notice: "Application opened. Advisory comes next." };
}

export async function recordAdvisoryAction(
  previous: RecognitionState,
  formData: FormData,
): Promise<RecognitionState> {
  const session = await requireSession();
  const values = fields(formData, [
    "applicationId",
    "advisedOn",
    "adviceGiven",
  ]);

  try {
    await recordAdvisory(session, values as never);
  } catch (error) {
    return fail(previous, error, values);
  }

  revalidatePath("/recognition");
  return { notice: "Advisory recorded." };
}

export async function recordJudgementAction(
  previous: RecognitionState,
  formData: FormData,
): Promise<RecognitionState> {
  const session = await requireSession();
  const values = fields(formData, [
    "applicationId",
    "curriculumModuleId",
    "rationale",
    "judgedOn",
    "competent",
  ]);

  try {
    await recordRplJudgement(session, {
      ...values,
      competent: values.competent === "on",
    } as never);
  } catch (error) {
    return fail(previous, error, values);
  }

  revalidatePath("/recognition");
  return {
    notice: "Judgement recorded. It grants nothing until it is moderated.",
  };
}

export async function moderateJudgementAction(
  previous: RecognitionState,
  formData: FormData,
): Promise<RecognitionState> {
  const session = await requireSession();
  const values = fields(formData, [
    "judgementId",
    "comment",
    "grantedOn",
    "agreed",
  ]);

  try {
    await moderateRplJudgement(session, {
      judgementId: values.judgementId,
      comment: values.comment,
      grantedOn: values.grantedOn,
      agreed: values.agreed === "on",
    });
  } catch (error) {
    return fail(previous, error, values);
  }

  revalidatePath("/recognition");
  return { notice: "Moderated." };
}

export async function recordTransferAction(
  previous: RecognitionState,
  formData: FormData,
): Promise<RecognitionState> {
  const session = await requireSession();
  const values = fields(formData, [
    "learnerId",
    "curriculumModuleId",
    "sourceQualification",
    "sourceProvider",
    "sourceSaqaId",
    "sourceCredits",
    "awardedOn",
    "mapping",
    "approvedOn",
  ]);

  try {
    await recordCreditTransfer(session, {
      ...values,
      sourceProvider: values.sourceProvider || undefined,
      sourceSaqaId: values.sourceSaqaId || undefined,
      sourceCredits: values.sourceCredits || undefined,
      awardedOn: values.awardedOn || undefined,
    } as never);
  } catch (error) {
    return fail(previous, error, values);
  }

  revalidatePath("/recognition");
  return { notice: "Credit transfer recorded." };
}
