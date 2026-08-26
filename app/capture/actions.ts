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
import type { ParsedPaper } from "@/lib/capture-parse";
import { NotReadyError } from "@/lib/programme-readiness";
import { PaperError } from "@/lib/papers";
import { PermissionDeniedError } from "@/lib/rbac";

export type CaptureState = { error?: string; gaps?: string[] };

export async function uploadCaptureAction(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const session = await requirePermission("assessment:author");

  const qualificationId = String(formData.get("qualificationId") ?? "");
  const paper = formData.get("paper");
  const guide = formData.get("guide");

  if (!qualificationId) {
    return { error: "Choose the qualification this material belongs to." };
  }
  if (!(paper instanceof File) || paper.size === 0) {
    return { error: "Choose the learner's copy of the paper." };
  }

  let jobId: string;
  try {
    const result = await proposeCapture(session, {
      qualificationId,
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
    // The sequencing refusal is not a failure to explain away: it is the
    // platform telling somebody what to do first, so it says exactly that.
    if (error instanceof NotReadyError) {
      return {
        error: error.message,
        gaps: error.gaps.map((gap) => `${gap.what} ${gap.action}`),
      };
    }
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
  const edited = String(formData.get("confirmed") ?? "");

  if (!assessmentId) return { error: "Choose which assessment this belongs to." };
  if (!paperCode) return { error: "Give the paper a code, such as V1." };

  try {
    const job = await getCaptureJob(session, jobId);

    // What is committed is what the reviewer confirmed on screen, corrections
    // included — not what the parser originally proposed. Falling back to the
    // proposal when nothing was posted would silently discard their edits.
    let confirmed: ParsedPaper = job.proposal;
    if (edited) {
      try {
        confirmed = JSON.parse(edited) as ParsedPaper;
      } catch {
        return {
          error:
            "The corrections could not be read. Reload the page and try again — nothing has been committed.",
        };
      }
    }

    const problems = validate(confirmed);
    if (problems.length > 0) {
      return { error: problems[0] };
    }

    // Criterion codes are resolved here rather than in the parser, which knows
    // nothing about this tenant's curriculum. A code matching nothing is left
    // unlinked and said so on the screen, not invented.
    const codes = [
      ...new Set(
        confirmed.sections.flatMap((section) =>
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
      confirmed,
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

/**
 * Checks the shape of what came back from the browser.
 *
 * The reviewer's edits arrive as JSON from a page anybody signed in could
 * post to, so nothing about it is trusted: a stem the browser lost, a mark
 * that is now text, a correct answer pointing past the end of the options.
 */
function validate(paper: ParsedPaper): string[] {
  const problems: string[] = [];

  if (!Array.isArray(paper.sections) || paper.sections.length === 0) {
    return ["The confirmed paper has no sections."];
  }

  for (const section of paper.sections) {
    if (!section.title?.trim()) {
      problems.push("A section has no title.");
    }

    for (const item of section.items ?? []) {
      if (!item.stem?.trim()) {
        problems.push(`A question in "${section.title}" has no wording.`);
      }
      if (
        item.points !== null &&
        (typeof item.points !== "number" || item.points < 0)
      ) {
        problems.push(
          `"${item.stem?.slice(0, 40)}…" has a mark that is not a number.`,
        );
      }
      if (
        item.correctIndex !== null &&
        (item.correctIndex < 0 || item.correctIndex >= (item.options?.length ?? 0))
      ) {
        problems.push(
          `"${item.stem?.slice(0, 40)}…" has a correct answer that is not one of its options.`,
        );
      }
    }
  }

  return problems;
}
