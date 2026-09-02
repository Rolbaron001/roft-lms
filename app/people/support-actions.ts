"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/request";
import {
  SupportError,
  closeSupportNeed,
  recordAdditionalDateOutcome,
  recordMissedAssessment,
  recordSupportNeed,
  recordSupportReview,
} from "@/lib/support";
import { PermissionDeniedError } from "@/lib/rbac";

export type SupportActionState = { error?: string; notice?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function run(
  work: () => Promise<unknown>,
  notice: string,
  paths: string[],
): Promise<SupportActionState> {
  try {
    await work();
  } catch (error) {
    if (error instanceof SupportError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    if (error && typeof error === "object" && "issues" in error) {
      return {
        error: (error as { issues: { message: string }[] }).issues
          .map((issue) => issue.message)
          .join(" "),
      };
    }
    console.error(error);
    return { error: "That could not be saved. Please try again." };
  }

  for (const path of paths) revalidatePath(path);
  return { notice };
}

export async function recordSupportNeedAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const session = await requirePermission("support:manage");
  const learnerId = field(formData, "learnerId");

  return run(
    () =>
      recordSupportNeed(session, {
        learnerId,
        category: field(formData, "category") as
          | "mobility"
          | "psychological"
          | "economic"
          | "sensory"
          | "other",
        need: field(formData, "need") || undefined,
        accommodation: field(formData, "accommodation"),
        learnerConsented: formData.get("learnerConsented") === "on",
        employerInformed: formData.get("employerInformed") === "on",
        employerRepresentative:
          field(formData, "employerRepresentative") || undefined,
        reviewDue: field(formData, "reviewDue") || undefined,
      }),
    "Recorded. Whoever is teaching this learner will see the accommodation.",
    [`/people/${learnerId}`],
  );
}

export async function recordReviewAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const session = await requirePermission("support:manage");
  const learnerId = field(formData, "learnerId");

  return run(
    () =>
      recordSupportReview(session, {
        supportNeedId: field(formData, "supportNeedId"),
        reviewedOn: field(formData, "reviewedOn"),
        working: field(formData, "working") === "yes",
        note: field(formData, "note"),
        adjustment: field(formData, "adjustment") || undefined,
        nextReviewDue: field(formData, "nextReviewDue") || undefined,
      }),
    "Review recorded.",
    [`/people/${learnerId}`],
  );
}

export async function closeSupportNeedAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const session = await requirePermission("support:manage");
  const learnerId = field(formData, "learnerId");

  return run(
    () =>
      closeSupportNeed(session, {
        supportNeedId: field(formData, "supportNeedId"),
        reason: field(formData, "reason"),
      }),
    "Closed.",
    [`/people/${learnerId}`],
  );
}

export async function recordMissedAssessmentAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const session = await requirePermission("support:manage");
  const learnerId = field(formData, "learnerId");

  return run(
    () =>
      recordMissedAssessment(session, {
        learnerId,
        assessmentId: field(formData, "assessmentId"),
        missedOn: field(formData, "missedOn"),
        missedReason: field(formData, "missedReason") || undefined,
        additionalDate: field(formData, "additionalDate"),
      }),
    "Additional date set. The procedure allows one, so there will not be another.",
    [`/people/${learnerId}`],
  );
}

export async function recordAdditionalDateOutcomeAction(
  _previous: SupportActionState,
  formData: FormData,
): Promise<SupportActionState> {
  const session = await requirePermission("support:manage");
  const learnerId = field(formData, "learnerId");

  return run(
    () =>
      recordAdditionalDateOutcome(session, {
        missedAssessmentId: field(formData, "missedAssessmentId"),
        outcome: field(formData, "outcome") as
          | "sat"
          | "oral_authorised"
          | "forfeited",
        medical: formData.get("medical") === "on",
        note: field(formData, "note") || undefined,
      }),
    "Recorded.",
    [`/people/${learnerId}`],
  );
}
