"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { updateCombinedRolesAction, type ClockState } from "./actions";

/**
 * Facilitator and assessor as one role (Heidi, 13 November 2026; D50). A
 * provider choice, because another provider may keep a facilitator who does
 * not assess.
 */
export function RolesForm({ combined }: { combined: boolean }) {
  const t = useT();
  const [state, action, saving] = useActionState<ClockState, FormData>(updateCombinedRolesAction, {});

  return (
    <Card title={t("rolesSettings.title")} description={t("rolesSettings.note")}>
      {/* Keyed by what is saved, so the box shows it after a save. */}
      <form key={String(combined)} action={action} className="space-y-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="combined" defaultChecked={combined} className="mt-1" />
          <span>
            {t("rolesSettings.combined")}
            <span className="block text-xs text-[var(--muted)]">{t("rolesSettings.combinedHint")}</span>
          </span>
        </label>
        <button type="submit" disabled={saving} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {saving ? t("common.saving") : t("common.save")}
        </button>
        {state.notice ? <p role="status" className="text-[var(--success)]">{state.notice}</p> : null}
        {state.error ? <p role="alert" className="text-[var(--danger)]">{state.error}</p> : null}
      </form>
    </Card>
  );
}
