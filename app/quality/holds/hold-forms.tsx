"use client";

import { useActionState } from "react";
import { useT } from "@/components/i18n";
import { liftHoldAction, placeHoldAction, type HoldState } from "./actions";

const input = "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm";

/** Placing a compliance hold (D51). */
export function PlaceHold({ qualifications, cohorts }: { qualifications: { id: string; name: string }[]; cohorts: { id: string; name: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState<HoldState, FormData>(placeHoldAction, {});
  return (
    <form action={action} className="space-y-3 text-sm">
      <label className="block space-y-1">
        <span className="block font-medium">{t("holds.on")}</span>
        <select name="target" required className={input} defaultValue="">
          <option value="" disabled>
            {t("holds.choose")}
          </option>
          <optgroup label={t("holds.qualifications")}>
            {qualifications.map((one) => (
              <option key={one.id} value={`qualification:${one.id}`}>
                {one.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("holds.cohorts")}>
            {cohorts.map((one) => (
              <option key={one.id} value={`cohort:${one.id}`}>
                {one.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="block space-y-1">
        <span className="block font-medium">{t("holds.reason")}</span>
        <textarea name="reason" required rows={3} className={input} placeholder={t("holds.reasonHint")} />
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 font-medium text-white disabled:opacity-60">
        {pending ? t("common.saving") : t("holds.place")}
      </button>
      {state.error ? <p role="alert" className="text-[var(--danger)]">{state.error}</p> : null}
      {state.notice ? <p role="status" className="text-[var(--success)]">{state.notice}</p> : null}
    </form>
  );
}

/** Lifting a standing hold, with what was resolved. */
export function LiftHold({ holdId }: { holdId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<HoldState, FormData>(liftHoldAction, {});
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
      <input type="hidden" name="holdId" value={holdId} />
      <input name="note" required placeholder={t("holds.liftNote")} className="min-w-64 flex-1 rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm" />
      <button type="submit" disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-1.5 font-medium disabled:opacity-60">
        {pending ? t("common.saving") : t("holds.lift")}
      </button>
      {state.error ? <p role="alert" className="w-full text-[var(--danger)]">{state.error}</p> : null}
      {state.notice ? <p role="status" className="w-full text-[var(--success)]">{state.notice}</p> : null}
    </form>
  );
}
