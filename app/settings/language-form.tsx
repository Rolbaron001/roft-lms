"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { LOCALES } from "@/lib/i18n/locales";
import { setProviderLanguageAction, type ProviderLanguageState } from "./language-actions";

/** The language a provider's people read the platform in by default (job sheet D9). */
export function ProviderLanguageForm({ current }: { current: string }) {
  const t = useT();
  const [state, action, saving] = useActionState<ProviderLanguageState, FormData>(setProviderLanguageAction, {});

  return (
    <Card title={t("providerLang.title")} description={t("providerLang.note")}>
      <form action={action} className="space-y-3">
        <select
          name="locale"
          defaultValue={current}
          aria-label={t("providerLang.label")}
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm sm:w-80"
        >
          {LOCALES.map((locale) => (
            <option key={locale.code} value={locale.code}>
              {locale.english}
              {locale.native !== locale.english ? ` (${locale.native})` : ""}
              {locale.state === "complete" ? "" : ` (${t(`language.state.${locale.state}`)})`}
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
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </Card>
  );
}
