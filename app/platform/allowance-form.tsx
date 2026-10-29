"use client";

import { useActionState } from "react";
import { useT } from "@/components/i18n";
import { setClassroomAllowanceAction, type PlatformState } from "./actions";

/**
 * How many classes one provider may hold in the shared LMS classroom at once
 * (Roland, 29 October 2026). Empty: the deployment's limit only. Nought: the
 * classroom is not offered to the provider.
 */
export function AllowanceForm({ tenantId, allowance }: { tenantId: string; allowance: number | null }) {
  const t = useT();
  const [state, action, saving] = useActionState<PlatformState, FormData>(setClassroomAllowanceAction, {});

  return (
    // Keyed by what is saved, so the box shows it after a save.
    <form key={String(allowance)} action={action} className="flex items-center gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input
        name="allowance"
        type="number"
        min={0}
        step={1}
        defaultValue={allowance ?? ""}
        placeholder={t("platformPage.allowanceAny")}
        aria-label={t("platformPage.allowance")}
        className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs tabular-nums"
      />
      <button type="submit" disabled={saving} className="text-xs font-medium text-[var(--brand-accent)] hover:underline disabled:opacity-60">
        {saving ? t("dateStyle.saving") : t("dateStyle.save")}
      </button>
      {state.notice ? <span className="text-xs text-[var(--success)]">{state.notice}</span> : null}
      {state.error ? <span role="alert" className="text-xs text-[var(--danger)]">{state.error}</span> : null}
    </form>
  );
}
