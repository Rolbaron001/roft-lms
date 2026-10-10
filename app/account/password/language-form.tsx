"use client";

import { useActionState } from "react";
import { LOCALES } from "@/lib/i18n/locales";
import { useT } from "@/components/i18n";
import { LanguageDisclaimer } from "@/components/language-disclaimer";
import { chooseLanguageAction, type LanguageState } from "./actions";

/** A person choosing the language the platform speaks to them in (job sheet D9). */
export function LanguageForm({
  current,
  providerLanguage,
}: {
  /** Their own choice, or null where they follow the provider's. */
  current: string | null;
  /** The provider's default, by its own name. */
  providerLanguage: string;
}) {
  const t = useT();
  const [state, action, pending] = useActionState<LanguageState, FormData>(chooseLanguageAction, {});

  return (
    <form action={action} className="space-y-3" data-own-sitting>
      <p className="text-xs text-[var(--muted)]">{t("account.languageIntro")}</p>
      <select
        name="locale"
        defaultValue={current ?? ""}
        aria-label={t("account.languageHeading")}
        className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
      >
        <option value="">{t("account.languageProvider", { language: providerLanguage })}</option>
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.native}
            {locale.state === "complete" ? "" : ` (${t(locale.state === "draft" ? "language.state.draft" : "language.state.planned")})`}
          </option>
        ))}
      </select>
      <LanguageDisclaimer />
      {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
      >
        {t("account.languageSave")}
      </button>
    </form>
  );
}
