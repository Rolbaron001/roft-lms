"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { answerFiled } from "@/lib/filed-map";
import type { MapAnswer } from "@/lib/programme-map";
import { PermissionDeniedError } from "@/lib/rbac";

/** One answer on a built qualification's map, saved to its documents (D60 stage 4). */
export async function filedAnswerAction(qualificationId: string, answer: MapAnswer | "all"): Promise<{ error?: string }> {
  const session = await requirePermission("qualification:manage");
  try {
    await answerFiled(session, qualificationId, answer);
  } catch (error) {
    if (error instanceof PermissionDeniedError) return said({ error: "Your role does not include managing qualifications." });
    throw error;
  }
  revalidatePath(`/qualifications/${qualificationId}/map`);
  return {};
}
