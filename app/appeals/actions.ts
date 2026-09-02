"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  AppealError,
  acknowledgeAppeal,
  addAppealNote,
  lodgeAppeal,
  recordAppealProgress,
  recordLearnerInformed,
  resolveAppeal,
  withdrawAppeal,
} from "@/lib/appeals";
import { PermissionDeniedError } from "@/lib/rbac";

export type AppealActionState = {
  error?: string;
  notice?: string;
  /**
   * Set when the only thing standing in the way is a missing reason for
   * accepting a late appeal, so the form can ask for it rather than looking
   * like a dead end.
   */
  needsLateReason?: boolean;
  /**
   * What was typed, handed back so a refusal does not empty the form.
   *
   * React resets a form once its action completes, which is right for a
   * submission that worked and wrong for one that was refused. Somebody who
   * has just written three paragraphs of a learner's account and is told the
   * appeal is out of time should not have to write them again - and the one
   * who does write them again writes less.
   */
  values?: Record<string, string>;
  /** Bumped on every refusal, so the form re-mounts around the values above. */
  attempt?: number;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function run(
  work: () => Promise<unknown>,
  notice: string,
  paths: string[],
  keep?: { previous: AppealActionState; values: Record<string, string> },
): Promise<AppealActionState> {
  const refused = (state: AppealActionState): AppealActionState =>
    keep
      ? {
          ...state,
          values: keep.values,
          attempt: (keep.previous.attempt ?? 0) + 1,
        }
      : state;

  try {
    await work();
  } catch (error) {
    if (error instanceof AppealError) {
      return refused({
        error: error.message,
        needsLateReason: error.reason === "out_of_time",
      });
    }
    if (error instanceof PermissionDeniedError) {
      return refused({ error: "Your role does not allow that." });
    }
    if (error && typeof error === "object" && "issues" in error) {
      return refused({
        error: (error as { issues: { message: string }[] }).issues
          .map((issue) => issue.message)
          .join(" "),
      });
    }
    console.error(error);
    return refused({ error: "That could not be saved. Please try again." });
  }

  for (const path of paths) revalidatePath(path);
  return { notice };
}

export async function lodgeAppealAction(
  previous: AppealActionState,
  formData: FormData,
): Promise<AppealActionState> {
  const session = await requirePermission("appeal:lodge");
  const { timezone } = await requireTenant();

  const values = {
    cohortId: field(formData, "cohortId"),
    ground: field(formData, "ground"),
    assessmentId: field(formData, "assessmentId"),
    triggeredOn: field(formData, "triggeredOn"),
    statement: field(formData, "statement"),
    lateAcceptanceReason: field(formData, "lateAcceptanceReason"),
  };

  return run(
    () =>
      lodgeAppeal(session, timezone, {
        learnerId: field(formData, "learnerId") || session.userId,
        cohortId: values.cohortId,
        ground: values.ground as "result" | "assessor_conduct",
        assessmentId: values.assessmentId || undefined,
        triggeredOn: values.triggeredOn,
        statement: values.statement,
        lateAcceptanceReason: values.lateAcceptanceReason || undefined,
      }),
    "Appeal lodged. The clock on acknowledging it starts now.",
    ["/appeals"],
    { previous, values },
  );
}

export async function acknowledgeAppealAction(
  _previous: AppealActionState,
  formData: FormData,
): Promise<AppealActionState> {
  const session = await requirePermission("appeal:manage");
  const appealId = field(formData, "appealId");

  return run(
    () => acknowledgeAppeal(session, appealId),
    "Acknowledged.",
    ["/appeals", `/appeals/${appealId}`],
  );
}

export async function recordProgressAction(
  _previous: AppealActionState,
  formData: FormData,
): Promise<AppealActionState> {
  const session = await requirePermission("appeal:manage");
  const appealId = field(formData, "appealId");

  return run(
    () =>
      recordAppealProgress(session, {
        appealId,
        metLearnerOn: field(formData, "metLearnerOn") || undefined,
        moderatorId: field(formData, "moderatorId") || undefined,
      }),
    "Recorded.",
    ["/appeals", `/appeals/${appealId}`],
  );
}

export async function resolveAppealAction(
  _previous: AppealActionState,
  formData: FormData,
): Promise<AppealActionState> {
  const session = await requirePermission("appeal:manage");
  const appealId = field(formData, "appealId");

  return run(
    () =>
      resolveAppeal(session, {
        appealId,
        outcome: field(formData, "outcome") as
          | "upheld"
          | "partially_upheld"
          | "dismissed",
        outcomeReason: field(formData, "outcomeReason"),
      }),
    "Resolved. Tell the learner, then record that you have.",
    ["/appeals", `/appeals/${appealId}`],
  );
}

export async function learnerInformedAction(
  _previous: AppealActionState,
  formData: FormData,
): Promise<AppealActionState> {
  const session = await requirePermission("appeal:manage");
  const appealId = field(formData, "appealId");

  return run(
    () => recordLearnerInformed(session, appealId),
    "Recorded.",
    ["/appeals", `/appeals/${appealId}`],
  );
}

export async function withdrawAppealAction(
  _previous: AppealActionState,
  formData: FormData,
): Promise<AppealActionState> {
  const session = await requirePermission("appeal:manage");
  const appealId = field(formData, "appealId");

  return run(
    () => withdrawAppeal(session, { appealId, reason: field(formData, "reason") }),
    "Withdrawn.",
    ["/appeals", `/appeals/${appealId}`],
  );
}

export async function addNoteAction(
  _previous: AppealActionState,
  formData: FormData,
): Promise<AppealActionState> {
  const session = await requirePermission("appeal:manage");
  const appealId = field(formData, "appealId");

  return run(
    () =>
      addAppealNote(session, {
        appealId,
        note: field(formData, "note"),
        visibleToLearner: formData.get("visibleToLearner") === "on",
      }),
    "Noted.",
    [`/appeals/${appealId}`],
  );
}
