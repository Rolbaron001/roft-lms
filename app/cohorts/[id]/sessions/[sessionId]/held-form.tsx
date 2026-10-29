"use client";

import { useActionState } from "react";
import { setSessionMethodAction, type CohortActionState } from "@/app/cohorts/actions";
import { useT } from "@/components/i18n";
import { LIVE_CLASS_METHODS, type LiveClassMethod } from "@/lib/classroom-rules";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * How this one session is held (Roland, 29 October 2026): the provider's usual
 * way, or another. Used to move a class out of a full classroom, or out of one
 * that failed on the night, and to give it its meeting link.
 */
export function HeldForm({
  cohortId,
  sessionId,
  usual,
  current,
  meetingUrl,
  classroomOffered,
}: {
  cohortId: string;
  sessionId: string;
  /** The provider's usual way. */
  usual: LiveClassMethod;
  /** This session's own way, or null for the usual one. */
  current: LiveClassMethod | null;
  meetingUrl: string | null;
  /** False when the operator has not offered the classroom to this provider. */
  classroomOffered: boolean;
}) {
  const t = useT();
  const [state, action, saving] = useActionState<CohortActionState, FormData>(setSessionMethodAction, {});

  return (
    // Keyed by what is saved: after a save React resets the form to the
    // defaults it was first drawn with, which would show the old choice.
    <form key={`${current ?? ""}|${meetingUrl ?? ""}`} action={action} className="flex flex-wrap items-end gap-3 text-sm">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <label className="block space-y-1.5">
        <span className="block font-medium">{t("heldBy.way")}</span>
        <select name="liveClassMethod" defaultValue={current ?? ""} className={inputClass}>
          <option value="">{t("heldBy.usual", { way: t(`classroomSettings.method.${usual}`) })}</option>
          {LIVE_CLASS_METHODS.filter((method) => classroomOffered || method !== "lms_classroom").map((method) => (
            <option key={method} value={method}>
              {t(`classroomSettings.method.${method}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-64 flex-1 space-y-1.5">
        <span className="block font-medium">{t("rollout.link")}</span>
        <input name="meetingUrl" type="text" inputMode="url" defaultValue={meetingUrl ?? ""} placeholder={t("rollout.linkHint")} className={`${inputClass} w-full`} />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md px-4 py-2 font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {saving ? t("dateStyle.saving") : t("dateStyle.save")}
      </button>
      <p className="w-full text-xs text-[var(--muted)]">{t("heldBy.note")}</p>
      {state.done ? <p className="w-full text-[var(--success)]">{state.done}</p> : null}
      {state.error ? <p role="alert" className="w-full text-[var(--danger)]">{state.error}</p> : null}
    </form>
  );
}
