"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { saveQuestionnaireAction, type ClockState } from "./actions";

type Row = { prompt: string; kind: "rating" | "text"; required: boolean };

/**
 * The provider's own programme feedback questions and rating scale (job sheet
 * D20). Curiosa rate satisfaction and relevance on four-point scales; another
 * provider will have its own, so both are set here, not in the platform.
 */
export function FeedbackQuestionsForm({ questions, scale }: { questions: Row[]; scale: string[] }) {
  const t = useT();
  const [state, action, saving] = useActionState<ClockState, FormData>(saveQuestionnaireAction, {});
  const [rows, setRows] = useState<Row[]>(questions);
  const update = (index: number, change: Partial<Row>) => setRows((all) => all.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const field = "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

  return (
    <Card title={t("fbq.title")} description={t("fbq.note")}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="questions" value={JSON.stringify(rows)} />
        <ol className="space-y-3">
          {rows.map((row, index) => (
            <li key={index} className="rounded-md border border-[var(--border)] p-3">
              <label className="block text-xs font-medium text-[var(--muted)]">
                {t("fbq.question")} {index + 1}
                <input value={row.prompt} onChange={(event) => update(index, { prompt: event.target.value })} className={`mt-1 ${field}`} />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  {t("fbq.kind")}
                  <select value={row.kind} onChange={(event) => update(index, { kind: event.target.value as Row["kind"] })} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm">
                    <option value="rating">{t("fbq.kind.rating")}</option>
                    <option value="text">{t("fbq.kind.text")}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={row.required} onChange={(event) => update(index, { required: event.target.checked })} />
                  {t("fbq.required")}
                </label>
                <button type="button" onClick={() => setRows((all) => all.filter((_, at) => at !== index))} className="text-[var(--danger)] underline underline-offset-2">
                  {t("fbq.remove")}
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setRows((all) => [...all, { prompt: "", kind: "rating", required: true }])} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium">
          {t("fbq.add")}
        </button>
        <label className="block text-sm font-medium">
          {t("fbq.scale")}
          <textarea name="scale" rows={5} defaultValue={scale.join("\n")} placeholder={t("fbq.scaleHint")} className={`mt-1 ${field}`} />
          <span className="mt-1 block text-xs font-normal text-[var(--muted)]">{t("fbq.scaleHint")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
            {saving ? t("fbq.saving") : t("fbq.save")}
          </button>
          {state.notice ? <p role="status" className="text-sm text-[var(--success)]">{state.notice}</p> : null}
          {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
        </div>
      </form>
    </Card>
  );
}
