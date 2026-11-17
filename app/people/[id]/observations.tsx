"use client";

import { useActionState, useEffect, useRef } from "react";
import { DateField } from "@/components/date-field";
import { useDay, useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";
import type { Observation } from "@/lib/observations";
import { logObservationAction, type ObservationState } from "./observation-actions";

const KINDS = ["behaviour", "progress", "attendance", "other"] as const;
const field = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/** A learner's observations, and logging another (job sheet D52 (2)). */
export function Observations({
  learnerId,
  today,
  rows,
  cohorts,
  canWrite,
}: {
  learnerId: string;
  today: string;
  rows: Observation[];
  cohorts: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const t = useT();
  const { day } = useDay();
  const [state, action, pending] = useActionState<ObservationState, FormData>(logObservationAction, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.notice) form.current?.reset();
  }, [state.notice]);

  return (
    <div className="space-y-4">
      {canWrite ? (
        <form ref={form} action={action} className="max-w-2xl space-y-2">
          <input type="hidden" name="learnerId" value={learnerId} />
          <div className="flex flex-wrap gap-2">
            <select name="kind" required defaultValue="progress" className={field} aria-label={t("observe.kind")}>
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {maybe(t, `observe.kind.${kind}`) ?? kind}
                </option>
              ))}
            </select>
            <DateField name="observedOn" defaultValue={today} required className={field} />
            {cohorts.length > 0 ? (
              <select name="cohortId" defaultValue={cohorts[0].id} className={field} aria-label={t("observe.cohort")}>
                {cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.name}
                  </option>
                ))}
                <option value="">{t("observe.noCohort")}</option>
              </select>
            ) : null}
          </div>
          <textarea name="note" required minLength={3} maxLength={4000} rows={3} placeholder={t("observe.placeholder")} className={`${field} block w-full`} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-60">
              {pending ? t("observe.logging") : t("observe.log")}
            </button>
            {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
            {state.error ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {state.error}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("observe.none")}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] text-sm">
          {rows.map((row) => (
            <li key={row.id} className="py-2">
              <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--foreground)]">{maybe(t, `observe.kind.${row.kind}`) ?? row.kind}</span>
                <span>{day(row.observedOn)}</span>
                {row.cohort ? <span>{row.cohort}</span> : null}
                {row.author ? <span>{row.author}</span> : null}
              </p>
              <p className="mt-0.5 whitespace-pre-line">{row.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
