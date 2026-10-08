"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { updateLeisaTargetAction, type ClockState } from "./actions";

/**
 * The provider's own target for sending the LEISA, in hours after the
 * induction (job sheet D19). Each cohort's LEISA shows it beside the
 * regulator's limit; empty, only the limit is shown.
 */
export function LeisaTargetForm({ current }: { current: number | null }) {
  const t = useT();
  const [state, action, saving] = useActionState<ClockState, FormData>(updateLeisaTargetAction, {});

  return (
    <Card title={t("leisaTarget.title")} description={t("leisaTarget.note")}>
      <form action={action} className="space-y-4">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t("leisaTarget.within")}</span>
          <input
            name="hours"
            type="number"
            min={1}
            max={504}
            step={1}
            defaultValue={current ?? ""}
            className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 tabular-nums"
          />
          <span>{t("leisaTarget.after")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand-primary)" }}
          >
            {saving ? t("dateStyle.saving") : t("dateStyle.save")}
          </button>
          {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
          {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
        </div>
      </form>
    </Card>
  );
}
