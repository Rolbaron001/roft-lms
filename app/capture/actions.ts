"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { requirePermission } from "@/lib/request";
import { withTenant } from "@/db/client";
import { assessmentCriteria } from "@/db/schema";
import {
  CaptureError,
  commitCapture,
  getCaptureJob,
  proposeCapture,
} from "@/lib/capture";
import { PaperError } from "@/lib/papers";
import { PermissionDeniedError } from "@/lib/rbac";

export type CaptureState = { error?: string };

export async function uploadCaptureAction(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const session = await requirePermission("assessment:author");

  const paper = formData.get("paper");
  const guide = formData.get("guide");

  if (!(paper instanceof File) || paper.size === 0) {
    return { error: "Choose the learner's copy of the paper." };
  }

  let jobId: string;
  try {
    const result = await proposeCapture(session, {
      paper: {
        filename: paper.name,
        bytes: new Uint8Array(await paper.arrayBuffer()),
      },
      guide:
        guide instanceof File && guide.size > 0
          ? {
              filename: guide.name,
              bytes: new Uint8Array(await guide.arrayBuffer()),
            }
          : undefined,
    });
    jobId = result.jobId;
  } catch (error) {
    if (error instanceof CaptureError || error instanceof PermissionDeniedError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect(`/capture/${jobId}`);
}

export async function commitCaptureAction(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const session = await requirePermission("assessment:author");

  const jobId = String(formData.get("jobId") ?? "");
  const assessmentId = String(formData.get("assessmentId") ?? "");
  const paperCode = String(formData.get("paperCode") ?? "").trim();

  if (!assessmentId) return { error: "Choose which assessment this belongs to." };
  if (!paperCode) return { error: "Give the paper a code, such as V1." };

  try {
    const job = await getCaptureJob(session, jobId);

    // Criterion codes are resolved here rather than in the parser, which knows
    // nothing about this tenant's curriculum. A code that matches nothing is
    // left unlinked and said so on the screen, not invented.
    const codes = [
      ...new Set(
        job.proposal.sections.flatMap((section) =>
          section.items.flatMap((item) => item.criterionCodes),
        ),
      ),
    ];

    const rows =
      codes.length === 0
        ? []
        : await withTenant(session.organisationId, (tx) =>
            tx
              .select({
                id: assessmentCriteria.id,
                code: assessmentCriteria.code,
              })
              .from(assessmentCriteria)
              .where(inArray(assessmentCriteria.code, codes)),
          );

    const result = await commitCapture(session, {
      jobId,
      assessmentId,
      paperCode,
      confirmed: job.proposal,
      criterionIds: Object.fromEntries(rows.map((row) => [row.code, row.id])),
      acknowledgedProblems: formData.get("acknowledgedProblems") === "on",
    });

    revalidatePath("/capture");

    if (!result.published.ok) {
      return {
        error:
          "Committed, but the paper could not be published: " +
          result.published.reasons.join(" "),
      };
    }
  } catch (error) {
    if (
      error instanceof CaptureError ||
      error instanceof PaperError ||
      error instanceof PermissionDeniedError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  redirect("/capture");
}
