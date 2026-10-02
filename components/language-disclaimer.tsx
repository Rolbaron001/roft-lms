"use client";

import { en } from "@/lib/i18n/en";
import { useT } from "./i18n";

/**
 * What a language choice gives and does not give. Job sheet D9.
 *
 * Roland, 2 October 2026: the translations are made by machine and will not
 * be checked by translators. English stays the platform's language; the
 * others are there to help somebody who finds English hard, and are not to be
 * mistaken for fluent or exact.
 *
 * Shown wherever a language is chosen. In the reader's language, and in
 * English as well when they are reading another one, since the English is
 * what counts and the person may not yet trust the translation to say so.
 */
export function LanguageDisclaimer() {
  const t = useT();
  const said = t("language.disclaimer");
  const english = en["language.disclaimer"];

  return (
    <div
      role="note"
      className="rounded-md border border-[var(--border)] bg-[var(--brand-accent)]/5 px-3 py-2 text-xs leading-relaxed"
    >
      <p>{said}</p>
      {said !== english ? (
        <p lang="en" className="mt-2 text-[var(--muted)]">
          {english}
        </p>
      ) : null}
    </div>
  );
}
