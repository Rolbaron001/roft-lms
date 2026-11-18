"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, said } from "@/lib/request";
import { createReport, ModerationReportError, saveReport, signReport } from "@/lib/moderation-report";

export type ReportState = { error?: string; notice?: string };

/** Starts a Moderation Report for a cohort or a qualification (job sheet D52 (4)). */
export async function createReportAction(_previous: ReportState, formData: FormData): Promise<ReportState> {
  const session = await requirePermission("assessment:moderate");
  const scope = String(formData.get("scope") ?? "");
  const [kind, id] = scope.split(":");
  let reportId: string;
  try {
    reportId = await createReport(session, kind === "cohort" ? { cohortId: id } : { qualificationId: id });
  } catch (error) {
    if (error instanceof ModerationReportError) return said({ error: error.message });
    throw error;
  }
  redirect(`/moderate/reports/${reportId}`);
}

export async function saveReportAction(_previous: ReportState, formData: FormData): Promise<ReportState> {
  const session = await requirePermission("assessment:moderate");
  const id = String(formData.get("reportId") ?? "");
  try {
    await saveReport(session, id, { findings: String(formData.get("findings") ?? ""), recommendations: String(formData.get("recommendations") ?? "") });
    revalidatePath(`/moderate/reports/${id}`);
    return said({ notice: "Saved." });
  } catch (error) {
    if (error instanceof ModerationReportError) return said({ error: error.message });
    throw error;
  }
}

/** Signs it off, which locks the moderated decisions it covers (job sheet D52 (5)). */
export async function signReportAction(_previous: ReportState, formData: FormData): Promise<ReportState> {
  const session = await requirePermission("assessment:moderate");
  const id = String(formData.get("reportId") ?? "");
  try {
    const { locked } = await signReport(session, id, { registrationNumber: String(formData.get("registrationNumber") ?? "") || undefined });
    revalidatePath(`/moderate/reports/${id}`);
    revalidatePath("/moderate/reports");
    return said({ notice: locked === 1 ? "Signed. One moderated decision is locked for external verification." : `Signed. ${locked} moderated decisions are locked for external verification.` });
  } catch (error) {
    if (error instanceof ModerationReportError) return said({ error: error.message });
    throw error;
  }
}
