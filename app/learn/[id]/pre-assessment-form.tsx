"use client";

import { useActionState, useState } from "react";
import type { Checklist } from "@/lib/pre-assessment";
import { confirmChecklistAction, type ChecklistState } from "./pre-assessment-actions";
import { useT } from "@/components/i18n";

/**
 * The pre-assessment checklist at the top of a study unit, until the learner
 * has confirmed it (job sheet D32). The declaration can be agreed to only once
 * every statement is ticked, and the server checks both again.
 */
export function PreAssessmentForm({
  checklist,
  courseId,
  enrolmentId,
  unitTitle,
}: {
  checklist: Checklist;
  courseId: string;
  enrolmentId: string;
  unitTitle: string;
}) {
  const t = useT();
  const [state, act, pending] = useActionState<ChecklistState, FormData>(confirmChecklistAction, {});
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [declared, setDeclared] = useState(false);
  const all = ticked.size === checklist.items.length;

  return (
    <section className="mb-6 rounded-lg border-2 border-[var(--brand-accent)]/60 bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">{t("pre.title")}</h2>
      <p className="text-sm text-[var(--muted)]">{t("pre.before", { unit: unitTitle })}</p>
      {checklist.introduction ? <p className="mt-3 max-w-3xl text-sm">{checklist.introduction}</p> : null}

      <form action={act} className="mt-4 space-y-4">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="enrolmentId" value={enrolmentId} />
        <p className="text-sm tabular-nums text-[var(--muted)]">{t("pre.progress", { done: ticked.size, total: checklist.items.length })}</p>
        <ul className="space-y-2">
          {checklist.items.map((item, index) => (
            <li key={index}>
              <label className="flex items-start gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="item"
                  value={index}
                  checked={ticked.has(index)}
                  onChange={(event) => {
                    const next = new Set(ticked);
                    if (event.target.checked) next.add(index);
                    else next.delete(index);
                    setTicked(next);
                    if (next.size < checklist.items.length) setDeclared(false);
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{item.title}</span>
                  {item.detail ? <span className="block text-[var(--muted)]">{item.detail}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="rounded-md bg-[var(--background)] p-3">
          <p className="text-sm font-semibold">{t("pre.declaration")}</p>
          <p className="mt-1 text-sm">{checklist.declaration}</p>
          <label className={`mt-2 flex items-center gap-2 text-sm ${all ? "" : "text-[var(--muted)]"}`}>
            <input type="checkbox" name="declaration" disabled={!all} checked={declared} onChange={(event) => setDeclared(event.target.checked)} />
            {t("pre.agree")}
          </label>
          {!all ? <p className="mt-1 text-xs text-[var(--muted)]">{t("pre.tickAll")}</p> : null}
        </div>

        {state.error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!all || !declared || pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? t("pre.confirming") : t("pre.confirm")}
        </button>
      </form>
    </section>
  );
}
