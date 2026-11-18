"use client";

import { useActionState, useState } from "react";
import { useT } from "@/components/i18n";
import { createReportAction, saveReportAction, signReportAction, type ReportState } from "./actions";

const field = "mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

function Said({ state }: { state: ReportState }) {
  return (
    <>
      {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
      {state.error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
    </>
  );
}

/** Starting a report for one of the moderator's cohorts or qualifications. */
export function NewReport({ scopes }: { scopes: { value: string; label: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState<ReportState, FormData>(createReportAction, {});
  if (scopes.length === 0) return <p className="text-sm text-[var(--muted)]">{t("modReport.noScopes")}</p>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="block text-xs text-[var(--muted)]">{t("modReport.for")}</span>
        <select name="scope" className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm">
          {scopes.map((scope) => (
            <option key={scope.value} value={scope.value}>
              {scope.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        {t("modReport.start")}
      </button>
      <Said state={state} />
    </form>
  );
}

/** Writing the findings and recommendations, and signing off. */
export function ReportEditor({
  reportId,
  findings,
  recommendations,
  registrationNumber,
}: {
  reportId: string;
  findings: string;
  recommendations: string;
  registrationNumber: string;
}) {
  const t = useT();
  const [saved, save, saving] = useActionState<ReportState, FormData>(saveReportAction, {});
  const [signed, sign, signing] = useActionState<ReportState, FormData>(signReportAction, {});
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-6">
      <form action={save} className="max-w-3xl space-y-3">
        <input type="hidden" name="reportId" value={reportId} />
        <label className="block text-sm">
          <span className="font-medium">{t("modReport.findings")}</span>
          <textarea name="findings" defaultValue={findings} rows={8} className={field} />
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t("modReport.recommendations")}</span>
          <textarea name="recommendations" defaultValue={recommendations} rows={5} className={field} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-60">
            {t("modReport.save")}
          </button>
          <Said state={saved} />
        </div>
      </form>

      <form action={sign} className="max-w-3xl space-y-3 rounded-lg border border-[var(--border)] p-4">
        <input type="hidden" name="reportId" value={reportId} />
        <p className="text-sm font-medium">{t("modReport.signTitle")}</p>
        <p className="text-sm text-[var(--muted)]">{t("modReport.signIntro")}</p>
        <label className="block text-sm">
          <span className="text-xs text-[var(--muted)]">{t("modReport.registration")}</span>
          <input name="registrationNumber" defaultValue={registrationNumber} className={field} />
        </label>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={signing} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              {signing ? t("modReport.signing") : t("modReport.signConfirm")}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-[var(--border)] px-4 py-2 text-sm">
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="rounded-md border border-[var(--brand-primary)] px-4 py-2 text-sm font-medium">
            {t("modReport.sign")}
          </button>
        )}
        <Said state={signed} />
      </form>
    </div>
  );
}
