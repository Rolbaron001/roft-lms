"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, said } from "@/lib/request";
import { PermissionDeniedError } from "@/lib/rbac";
import { buildQualification, buildSummary, verifyAndPublish } from "@/lib/qualification-build";

export type VerifyState = { error?: string; notice?: string; problems?: string[] };

/**
 * Builds whatever the qualification's documents settle and is not built yet
 * (lib/qualification-build.ts). For a qualification loaded before the build
 * ran by itself, and for after more documents are added; it fills gaps only.
 */
export async function buildQualificationAction(_previous: VerifyState, formData: FormData): Promise<VerifyState> {
  const session = await requirePermission("course:author");
  const qualificationId = String(formData.get("qualificationId") ?? "");
  try {
    const report = await buildQualification(session, qualificationId);
    revalidatePath(`/qualifications/${qualificationId}`);
    revalidatePath(`/qualifications/${qualificationId}/verify`);
    revalidatePath("/courses");
    return said({ notice: buildSummary(report) });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return said({ error: "Your role does not allow that." });
    console.error("qualification build failed", error);
    return said({ error: "The build stopped part of the way through. What was done is kept; press Build again to carry on." });
  }
}

/** The one act that makes a built qualification live, or says what holds it back. */
export async function verifyQualificationAction(_previous: VerifyState, formData: FormData): Promise<VerifyState> {
  const session = await requirePermission("course:publish");
  const qualificationId = String(formData.get("qualificationId") ?? "");
  try {
    const result = await verifyAndPublish(session, qualificationId);
    revalidatePath(`/qualifications/${qualificationId}`);
    revalidatePath(`/qualifications/${qualificationId}/verify`);
    revalidatePath("/courses");
    if (!result.ok) {
      return said({
        error: "Nothing was made live. These still need putting right first:",
        problems: result.blocking.map((finding) => finding.what),
      });
    }
    return said({ notice: "Verified and live. Learners can now be enrolled on its study units." });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return said({ error: "Your role does not allow that." });
    throw error;
  }
}
