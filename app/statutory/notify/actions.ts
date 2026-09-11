"use server";

import { revalidatePath } from "next/cache";
import {
  draftNotification,
  markSubmitted,
  NotificationError,
  recordAcknowledgement,
  setOwnInduction,
} from "@/lib/statutory-notification";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";

export type NotifyState = { error?: string; notice?: string };

function explain(error: unknown): NotifyState {
  if (error instanceof NotificationError) return { error: error.message };
  if (error instanceof PermissionDeniedError) {
    return { error: "Your role does not allow that." };
  }
  throw error;
}

/** Opens a submission covering the learners chosen on the page. */
export async function draftAction(
  _previous: NotifyState,
  formData: FormData,
): Promise<NotifyState> {
  const session = await requireSession();

  const learnerIds = formData.getAll("learnerIds").map(String).filter(Boolean);
  if (learnerIds.length === 0) {
    return { error: "Choose at least one learner to notify about." };
  }

  const kindRaw = String(formData.get("kind") ?? "");
  const kind =
    kindRaw === "full" || kindRaw === "part" || kindRaw === "skills_programme"
      ? kindRaw
      : undefined;

  try {
    await draftNotification(session, {
      title: String(formData.get("title") ?? "").trim() || "Enrolment notification",
      cohortId: String(formData.get("cohortId") ?? "") || null,
      inductionOn: String(formData.get("inductionOn") ?? ""),
      kind,
      learnerIds,
    });
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/statutory/notify");
  return {
    notice: `Drafted, covering ${learnerIds.length} ${learnerIds.length === 1 ? "learner" : "learners"}. Download the workbook, check it, then record that it went.`,
  };
}

/** Records that the workbook was uploaded to the QCTO. */
export async function submitAction(
  _previous: NotifyState,
  formData: FormData,
): Promise<NotifyState> {
  const session = await requireSession();

  try {
    await markSubmitted(session, String(formData.get("notificationId") ?? ""));
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/statutory/notify");
  return { notice: "Recorded as sent. Add the acknowledgement when it comes back." };
}

/** Records the reference the QCTO issued, and the date. */
export async function acknowledgeAction(
  _previous: NotifyState,
  formData: FormData,
): Promise<NotifyState> {
  const session = await requireSession();

  try {
    await recordAcknowledgement(
      session,
      String(formData.get("notificationId") ?? ""),
      {
        reference: String(formData.get("reference") ?? ""),
        acknowledgedOn:
          String(formData.get("acknowledgedOn") ?? "") ||
          new Date().toISOString().slice(0, 10),
      },
    );
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/statutory/notify");
  return { notice: "Acknowledgement recorded." };
}

/**
 * Gives a learner their own induction date.
 *
 * The late-joiner path: their clock starts on a different day to the cohort's,
 * so their deadline moves and they need their own submission.
 */
export async function ownInductionAction(
  _previous: NotifyState,
  formData: FormData,
): Promise<NotifyState> {
  const session = await requireSession();

  const on = String(formData.get("inductionOn") ?? "").trim();

  try {
    await setOwnInduction(
      session,
      String(formData.get("cohortId") ?? ""),
      String(formData.get("userId") ?? ""),
      on || null,
    );
  } catch (error) {
    return explain(error);
  }

  revalidatePath("/statutory/notify");
  return {
    notice: on
      ? "Their own induction date is recorded, and their deadline now runs from it."
      : "Back to the cohort's own induction date.",
  };
}
