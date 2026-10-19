"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import type { Checklist, ChecklistItem } from "@/lib/pre-assessment";
import { savePreAssessmentAction, type ClockState } from "./actions";

/**
 * The provider's pre-assessment checklist and declaration (job sheet D32). A
 * learner completes it before each study unit opens, once it is switched on.
 */
export function PreAssessmentSettings({ checklist }: { checklist: Checklist }) {
  const t = useT();
  const [state, action, saving] = useActionState<ClockState, FormData>(savePreAssessmentAction, {});
  const [items, setItems] = useState<ChecklistItem[]>(checklist.items);
  const update = (index: number, change: Partial<ChecklistItem>) =>
    setItems((all) => all.map((item, at) => (at === index ? { ...item, ...change } : item)));
  const field = "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

  return (
    <Card title={t("pre.settingsTitle")} description={t("pre.settingsNote")}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="enabled" defaultChecked={checklist.enabled} />
          {t("pre.enabled")}
        </label>
        <label className="block text-sm font-medium">
          {t("pre.introduction")}
          <textarea name="introduction" rows={4} defaultValue={checklist.introduction} className={`mt-1 ${field}`} />
        </label>
        <ol className="space-y-3">
          {items.map((item, index) => (
            <li key={index} className="rounded-md border border-[var(--border)] p-3">
              <label className="block text-xs font-medium text-[var(--muted)]">
                {t("pre.statement", { number: index + 1 })}
                <input value={item.title} onChange={(event) => update(index, { title: event.target.value })} className={`mt-1 ${field}`} />
              </label>
              <label className="mt-2 block text-xs font-medium text-[var(--muted)]">
                {t("pre.explanation")}
                <input value={item.detail} onChange={(event) => update(index, { detail: event.target.value })} className={`mt-1 ${field}`} />
              </label>
              <button type="button" onClick={() => setItems((all) => all.filter((_, at) => at !== index))} className="mt-2 text-sm text-[var(--danger)] underline underline-offset-2">
                {t("pre.remove")}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setItems((all) => [...all, { title: "", detail: "" }])} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium">
          {t("pre.add")}
        </button>
        <label className="block text-sm font-medium">
          {t("pre.declaration")}
          <textarea name="declaration" rows={4} defaultValue={checklist.declaration} className={`mt-1 ${field}`} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {state.error ? <span role="alert" className="text-sm text-[var(--danger)]">{state.error}</span> : null}
          {state.notice ? <span className="text-sm text-[var(--success)]">{state.notice}</span> : null}
        </div>
      </form>
    </Card>
  );
}
