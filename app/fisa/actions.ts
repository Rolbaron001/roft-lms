"use server";

import { revalidatePath } from "next/cache";
import {
  answerItem,
  appoint,
  createInstrument,
  FisaError,
  newVersion,
  recordCoverage,
  sendToModeration,
  signConfidentiality,
  signOff,
} from "@/lib/fisa";
import type { ChecklistAnswer } from "@/lib/fisa-checklist";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";

export type FisaState = { error?: string; notice?: string };

function explain(error: unknown): FisaState {
  if (error instanceof FisaError) return { error: error.message };
  if (error instanceof PermissionDeniedError) {
    return { error: "Your role does not allow that." };
  }
  throw error;
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function createAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();

  try {
    await createInstrument(session, {
      qualificationId: String(formData.get("qualificationId") ?? ""),
      title: String(formData.get("title") ?? "").trim(),
      durationMinutes: optionalNumber(formData.get("durationMinutes")),
      totalMarks: optionalNumber(formData.get("totalMarks")),
      passMarkPercent: optionalNumber(formData.get("passMarkPercent")),
      hasPracticalComponent: formData.get("hasPracticalComponent") === "on",
      practicalNote: String(formData.get("practicalNote") ?? "").trim(),
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/fisa");
  return { notice: "Opened. Appoint an examiner and a moderator next." };
}

export async function appointAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();
  const role = String(formData.get("role") ?? "");

  if (role !== "examiner" && role !== "moderator") {
    return { error: "Choose examiner or moderator." };
  }

  try {
    await appoint(session, {
      instrumentId: String(formData.get("instrumentId") ?? ""),
      role,
      userId: String(formData.get("userId") ?? "") || null,
      fullName: String(formData.get("fullName") ?? "").trim(),
      idNumber: String(formData.get("idNumber") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      mobile: String(formData.get("mobile") ?? "").trim(),
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/fisa/${formData.get("instrumentId")}`);
  return {
    notice: `Appointed. They cannot see the paper until the confidentiality agreement is signed.`,
  };
}

export async function signConfidentialityAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();

  try {
    await signConfidentiality(
      session,
      String(formData.get("appointmentId") ?? ""),
    );
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/fisa/${formData.get("instrumentId")}`);
  return { notice: "Agreement recorded. They may now work on the paper." };
}

export async function answerAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();
  const role = String(formData.get("role") ?? "");
  const answer = String(formData.get("answer") ?? "");

  if (role !== "examiner" && role !== "moderator") {
    return { error: "Unknown report." };
  }
  if (answer !== "yes" && answer !== "no" && answer !== "na") {
    return { error: "Answer yes or no." };
  }

  try {
    await answerItem(session, {
      instrumentId: String(formData.get("instrumentId") ?? ""),
      role,
      itemCode: String(formData.get("itemCode") ?? ""),
      answer: answer as ChecklistAnswer,
      recommendation: String(formData.get("recommendation") ?? ""),
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/fisa/${formData.get("instrumentId")}`);
  return {};
}

export async function coverageAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();
  const role = String(formData.get("role") ?? "");

  if (role !== "examiner" && role !== "moderator") {
    return { error: "Unknown report." };
  }

  const achieved = String(formData.get("standardAchieved") ?? "");

  try {
    await recordCoverage(session, {
      instrumentId: String(formData.get("instrumentId") ?? ""),
      role,
      exitLevelOutcomeId: String(formData.get("exitLevelOutcomeId") ?? ""),
      requiredStandard: String(formData.get("requiredStandard") ?? ""),
      competenceLevel: String(formData.get("competenceLevel") ?? ""),
      questionReference: String(formData.get("questionReference") ?? ""),
      comment: String(formData.get("comment") ?? ""),
      standardAchieved: achieved === "" ? undefined : achieved === "yes",
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/fisa/${formData.get("instrumentId")}`);
  return { notice: "Recorded." };
}

export async function sendToModerationAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();

  try {
    await sendToModeration(session, String(formData.get("instrumentId") ?? ""));
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/fisa/${formData.get("instrumentId")}`);
  return { notice: "Sent to the moderator, and they have been told." };
}

export async function signOffAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();

  try {
    await signOff(session, String(formData.get("instrumentId") ?? ""), {
      qualityRating: String(formData.get("qualityRating") ?? "good"),
      qualityMotivation: String(formData.get("qualityMotivation") ?? ""),
      comments: String(formData.get("comments") ?? ""),
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath(`/fisa/${formData.get("instrumentId")}`);
  return {
    notice: "Signed off as fit for purpose. Candidates may now sit this paper.",
  };
}

export async function newVersionAction(
  _previous: FisaState,
  formData: FormData,
): Promise<FisaState> {
  const session = await requireSession();

  try {
    await newVersion(session, String(formData.get("instrumentId") ?? ""));
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/fisa");
  return {
    notice:
      "A new draft version is open. It needs its own examiner, moderator and moderation.",
  };
}
