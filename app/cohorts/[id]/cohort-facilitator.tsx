"use client";

import { useActionState, useState } from "react";
import { setCohortFacilitatorAction, type StaffState } from "@/app/staff-actions";
import { useT } from "@/components/i18n";

/** The cohort's facilitator, shown and changed in place (job sheet D27). */
export function CohortFacilitator({
  cohortId,
  current,
  facilitators,
  canChange,
}: {
  cohortId: string;
  current: string | null;
  facilitators: { id: string; name: string; named: boolean }[];
  canChange: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<StaffState, FormData>(setCohortFacilitatorAction, {});
  const name = facilitators.find((person) => person.id === current)?.name ?? null;

  if (!editing) {
    return (
      <span>
        {t("cohort.facilitatorLabel")} {name ?? t("cohorts.facilitatorNone")}
        {canChange ? (
          <button type="button" onClick={() => setEditing(true)} className="ml-2 underline underline-offset-2 hover:text-[var(--foreground)]">
            {t("cohort.facilitatorChange")}
          </button>
        ) : null}
        {state.error ? <span role="alert" className="ml-2 text-[var(--danger)]">{state.error}</span> : null}
      </span>
    );
  }

  return (
    <form action={(formData) => { action(formData); setEditing(false); }} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="cohortId" value={cohortId} />
      <select name="facilitatorId" defaultValue={current ?? ""} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)]">
        <option value="">{t("cohorts.facilitatorNone")}</option>
        {facilitators.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
            {person.named ? ` · ${t("rollout.facilitatorNamed")}` : ""}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="rounded-md px-3 py-1 text-sm font-semibold text-white" style={{ background: "var(--brand-primary)" }}>
        {t("common.save")}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-sm underline underline-offset-2">
        {t("common.cancel")}
      </button>
    </form>
  );
}
