"use client";

import { useActionState } from "react";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";
import { removeDocumentAction, type RemoveState } from "./actions";

/**
 * Taking one document off its programme, with the reason, and optionally
 * keeping it in the Library (D63). Folded, so it is a deliberate act.
 */
export function RemoveDocumentForm({ documentId, categories }: { documentId: string; categories: readonly string[] }) {
  const t = useT();
  const [state, action, pending] = useActionState<RemoveState, FormData>(removeDocumentAction, {});
  return (
    <details className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-[var(--danger)]">{t("docRemove.open")}</summary>
      <form action={action} className="mt-3 grid max-w-xl gap-3">
        <input type="hidden" name="documentId" value={documentId} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("docRemove.reason")}</span>
          <textarea name="reason" required minLength={10} rows={2} className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("docRemove.keep")}</span>
          <select name="keepInLibraryAs" defaultValue="" className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <option value="">{t("docRemove.keepNo")}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {maybe(t, `records.category.${category}`) ?? category}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--muted)]">{t("docRemove.keepHint")}</span>
        </label>
        <div>
          <button type="submit" disabled={pending} className="rounded-md border border-[var(--danger)] px-4 py-2 text-sm font-medium text-[var(--danger)] disabled:opacity-60">
            {t("docRemove.button")}
          </button>
          {state.error ? (
            <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
              {state.error}
            </p>
          ) : null}
        </div>
      </form>
    </details>
  );
}
