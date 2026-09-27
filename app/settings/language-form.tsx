"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { LOCALES } from "@/lib/i18n/locales";
import { setProviderLanguageAction, type ProviderLanguageState } from "./language-actions";

const STATE_WORDS = { complete: "", draft: " (draft translation)", planned: " (not yet translated)" } as const;

/** The language a provider's people read the platform in by default (job sheet D9). */
export function ProviderLanguageForm({ current }: { current: string }) {
  const [state, action, saving] = useActionState<ProviderLanguageState, FormData>(setProviderLanguageAction, {});

  return (
    <Card
      title="Language"
      description="The language your people read the platform in, unless they choose their own under their name at the top of the page. Screens not yet translated stay in English, and your own names for things (Settings, Terminology) are kept as you wrote them in every language."
    >
      <form action={action} className="space-y-3">
        <select
          name="locale"
          defaultValue={current}
          aria-label="Default language"
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm sm:w-80"
        >
          {LOCALES.map((locale) => (
            <option key={locale.code} value={locale.code}>
              {locale.english}
              {locale.native !== locale.english ? ` (${locale.native})` : ""}
              {STATE_WORDS[locale.state]}
            </option>
          ))}
        </select>
        {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
        {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </Card>
  );
}
