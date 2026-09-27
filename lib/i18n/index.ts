import { af } from "./af";
import { en, type Catalogue, type MessageKey } from "./en";
import { DEFAULT_LOCALE, LOCALES, isLocale } from "./locales";
import type { Translation } from "./phrase-document";
import translatedData from "./translated.json";

/**
 * Putting a phrase into a person's language. Job sheet D9.
 *
 * Missing phrases fall back to English one at a time, so a language can be
 * added a screen at a time and a screen translated a phrase at a time, and
 * nothing ever shows as a blank or a key.
 *
 * This module imports nothing that reaches the database, so a client
 * component can use it.
 */

export type { MessageKey } from "./en";
export { maybe } from "./maybe";

/**
 * Translations read back from a numbered document (`scripts/translation-
 * import.mts`), by language. Each remembers the English it was made from; if
 * the English has changed since, the translation no longer says what the
 * screen means, and English shows until the phrase is translated again.
 */
const translated = translatedData as Record<string, Record<string, Translation>>;

function current(locale: string): Catalogue {
  const catalogue: Catalogue = {};
  for (const [key, entry] of Object.entries(translated[locale] ?? {})) {
    if (key in en && entry.from === en[key as MessageKey]) catalogue[key as MessageKey] = entry.text;
  }
  return catalogue;
}

const CATALOGUES: Record<string, Catalogue> = Object.fromEntries(
  LOCALES.map(({ code }) => [code, code === "en" ? en : code === "af" ? { ...current(code), ...af } : current(code)]),
);

/** How many of the platform's phrases a language has, for saying how far it has got. */
export function translatedCount(locale: string): number {
  return Object.keys(CATALOGUES[locale] ?? {}).length;
}

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function translator(locale: string | null | undefined): Translate {
  const catalogue = CATALOGUES[isLocale(locale) ? locale : DEFAULT_LOCALE] ?? {};
  return (key, values) => {
    const phrase = catalogue[key] ?? en[key] ?? key;
    return values ? phrase.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all)) : phrase;
  };
}

/** A catalogue for sending to the browser: the language's phrases, with English under them. */
export function catalogueFor(locale: string | null | undefined): Record<string, string> {
  return { ...en, ...(CATALOGUES[isLocale(locale) ? locale : DEFAULT_LOCALE] ?? {}) };
}
