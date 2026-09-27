import { af } from "./af";
import { en, type Catalogue, type MessageKey } from "./en";
import { DEFAULT_LOCALE, isLocale } from "./locales";

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

const CATALOGUES: Record<string, Catalogue> = { en, af };

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function translator(locale: string | null | undefined): Translate {
  const catalogue = CATALOGUES[isLocale(locale) ? locale : DEFAULT_LOCALE] ?? {};
  return (key, values) => {
    const phrase = catalogue[key] ?? en[key] ?? key;
    return values ? phrase.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all)) : phrase;
  };
}

/** The phrase for a key built at run time, such as a menu address, if the catalogue has one. */
export function maybe(t: Translate, key: string): string | null {
  return key in en ? t(key as MessageKey) : null;
}

/** A catalogue for sending to the browser: the language's phrases, with English under them. */
export function catalogueFor(locale: string | null | undefined): Record<string, string> {
  return { ...en, ...(CATALOGUES[isLocale(locale) ? locale : DEFAULT_LOCALE] ?? {}) };
}
