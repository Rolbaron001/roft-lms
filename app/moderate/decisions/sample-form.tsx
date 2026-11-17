"use client";

import { useActionState } from "react";
import { useDay, useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";
import type { DecisionRow } from "@/lib/moderation-sample";
import { addToSampleAction, type SampleState } from "./actions";

/** The decisions, ticked to add to the sample (job sheet D52 (3)). */
export function SampleForm({ rows }: { rows: DecisionRow[] }) {
  const t = useT();
  const { day } = useDay();
  const [state, action, pending] = useActionState<SampleState, FormData>(addToSampleAction, {});

  return (
    <form action={action}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="py-2 pr-2" />
              <th className="py-2 pr-3">{t("sample.learner")}</th>
              <th className="py-2 pr-3">{t("sample.assessment")}</th>
              <th className="py-2 pr-3">{t("sample.assessor")}</th>
              <th className="py-2 pr-3">{t("sample.outcome")}</th>
              <th className="py-2 pr-3">{t("sample.decided")}</th>
              <th className="py-2">{t("sample.moderation")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.decisionId}>
                <td className="py-2 pr-2">
                  {row.sampled ? null : <input type="checkbox" name="decisionId" value={row.decisionId} aria-label={t("sample.choose")} />}
                </td>
                <td className="py-2 pr-3">{row.learner}</td>
                <td className="py-2 pr-3">
                  {row.assessment}
                  {row.qualification ? <span className="block text-xs text-[var(--muted)]">{row.qualification}</span> : null}
                </td>
                <td className="py-2 pr-3">{row.assessor}</td>
                <td className="py-2 pr-3">{maybe(t, `outcome.${row.outcome}`) ?? row.outcome.replace(/_/g, " ")}</td>
                <td className="py-2 pr-3 text-xs text-[var(--muted)]">{row.decidedAt ? day(row.decidedAt) : ""}</td>
                <td className="py-2 text-xs">
                  {row.moderated
                    ? (maybe(t, `sample.moderated.${row.moderated}`) ?? row.moderated.replace(/_/g, " "))
                    : row.sampled
                      ? t("sample.inSample")
                      : <span className="text-[var(--muted)]">{t("sample.notSampled")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? t("sample.adding") : t("sample.add")}
        </button>
        {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
        {state.error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
