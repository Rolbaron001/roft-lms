/**
 * The languages the platform can be read in. Job sheet D9, 27 September 2026.
 *
 * Roland, 27 September: Afrikaans definitely; then all eleven written official
 * languages of South Africa; then Spanish, French, Italian, German and
 * Portuguese. "Enough for a start." South African Sign Language, official
 * since July 2023, is not written, so a screen cannot be put into it.
 *
 * `state` says how far a language has got, and is shown beside it wherever a
 * person chooses one, so nobody is surprised by English on a screen not yet
 * translated:
 *
 *   complete  every screen that has been moved into the catalogue is translated
 *             and checked by somebody who knows the language and the field
 *   draft     translated, not yet checked; a translator should go through it
 *   planned   chosen, not started; everything shows in English
 *
 * This module imports nothing, so a form can use it.
 */

export type LocaleState = "complete" | "draft" | "planned";

export type Locale = {
  /** BCP 47, as `<html lang>` and the browser expect. */
  code: string;
  /** The name in English, for staff choosing a provider's default. */
  english: string;
  /** The name in the language itself, for a person choosing their own. */
  native: string;
  state: LocaleState;
};

export const LOCALES: Locale[] = [
  { code: "en", english: "English", native: "English", state: "complete" },
  { code: "af", english: "Afrikaans", native: "Afrikaans", state: "draft" },
  { code: "zu", english: "isiZulu", native: "isiZulu", state: "planned" },
  { code: "xh", english: "isiXhosa", native: "isiXhosa", state: "planned" },
  { code: "nr", english: "isiNdebele", native: "isiNdebele", state: "planned" },
  { code: "nso", english: "Sepedi", native: "Sepedi", state: "planned" },
  { code: "st", english: "Sesotho", native: "Sesotho", state: "planned" },
  { code: "tn", english: "Setswana", native: "Setswana", state: "planned" },
  { code: "ss", english: "siSwati", native: "siSwati", state: "planned" },
  { code: "ve", english: "Tshivenda", native: "Tshivenḓa", state: "planned" },
  { code: "ts", english: "Xitsonga", native: "Xitsonga", state: "planned" },
  { code: "es", english: "Spanish", native: "Español", state: "planned" },
  { code: "fr", english: "French", native: "Français", state: "planned" },
  { code: "it", english: "Italian", native: "Italiano", state: "planned" },
  { code: "de", english: "German", native: "Deutsch", state: "planned" },
  { code: "pt", english: "Portuguese", native: "Português", state: "planned" },
];

export const DEFAULT_LOCALE = "en";

export function isLocale(code: string | null | undefined): code is string {
  return Boolean(code && LOCALES.some((locale) => locale.code === code));
}

export function localeOf(code: string | null | undefined): Locale {
  return LOCALES.find((locale) => locale.code === code) ?? LOCALES[0];
}

/**
 * The tag to format dates and numbers with. The South African form of each
 * language where the runtime knows it ("af-ZA" names the months in Afrikaans:
 * Oktober, Desember); South African English where it
 * does not, rather than the runtime's own default, which may be American.
 */
export function dateLocale(code: string | null | undefined): string {
  const language = isLocale(code) ? code : DEFAULT_LOCALE;
  const southern = !["es", "fr", "it", "de", "pt"].includes(language);
  for (const tag of southern ? [`${language}-ZA`, language] : [language]) {
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0) return tag;
    } catch {
      // An unusable tag: try the next.
    }
  }
  return "en-ZA";
}

/**
 * The language to speak to somebody in: their own choice, else their
 * provider's, else English.
 */
export function localeFor(
  tenant: { defaultLocale?: string | null } | null,
  person: { locale?: string | null } | null,
): string {
  const chosen = person?.locale ?? tenant?.defaultLocale ?? DEFAULT_LOCALE;
  return isLocale(chosen) ? chosen : DEFAULT_LOCALE;
}
