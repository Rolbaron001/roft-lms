"use client";

import Link from "next/link";
import { useActionState } from "react";
import { savePlanNotesAction, type CohortActionState } from "@/app/cohorts/actions";
import { useT } from "@/components/i18n";

/**
 * The facilitator's parts of the session's facilitation plan (job sheet D20):
 * the agenda, the resources and the proceedings. Everything else on the plan
 * is filled in from the record.
 */
export function PlanNotes({
  cohortId,
  sessionId,
  agenda,
  resources,
  proceedings,
}: {
  cohortId: string;
  sessionId: string;
  agenda: string | null;
  resources: string | null;
  proceedings: string | null;
}) {
  const t = useT();
  const [state, action, pending] = useActionState<CohortActionState, FormData>(savePlanNotesAction, {});
  const box = "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <label className="block text-sm font-medium">
        {t("plan.agenda")}
        <textarea name="agenda" rows={4} defaultValue={agenda ?? ""} placeholder={t("plan.agendaHint")} className={box} />
      </label>
      <label className="block text-sm font-medium">
        {t("plan.resources")}
        <textarea name="resources" rows={3} defaultValue={resources ?? ""} placeholder={t("plan.resourcesHint")} className={box} />
      </label>
      <label className="block text-sm font-medium">
        {t("plan.proceedings")}
        <textarea name="proceedings" rows={6} defaultValue={proceedings ?? ""} placeholder={t("plan.proceedingsHint")} className={box} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
          {pending ? t("common.saving") : t("plan.save")}
        </button>
        <Link href={`/cohorts/${cohortId}/sessions/${sessionId}/plan`} className="text-sm font-medium text-[var(--brand-primary)] underline underline-offset-2">
          {t("plan.open")}
        </Link>
        {state.done ? <p role="status" className="text-sm text-[var(--success)]">{state.done}</p> : null}
        {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
      </div>
    </form>
  );
}
