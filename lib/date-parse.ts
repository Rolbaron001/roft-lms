/**
 * Reading a date somebody typed, in the order the provider writes dates
 * (Roland and Heidi, 8 October 2026: the browser's own date box asked for the
 * year first, and Heidi "absolutely hated" it). Imports nothing, so the date
 * field in the browser and the tests can both use it.
 *
 * Accepted: 28/10/2026, 28-10-2026, 28.10.2026, 28 October 2026, 28 Oct 2026,
 * October 28 2026, and the stored form 2026-10-28. Numbers alone are read day
 * first, unless the order is month first (a reader whose own computer writes
 * dates the American way, under the "device" style).
 */

export type DayOrder = "dmy" | "mdy" | "ymd";

function monthNames(languages: string[]): Map<string, number> {
  const names = new Map<string, number>();
  for (const language of languages) {
    for (const month of ["long", "short"] as const) {
      let format: Intl.DateTimeFormat;
      try {
        format = new Intl.DateTimeFormat(language, { month, timeZone: "UTC" });
      } catch {
        continue;
      }
      for (let index = 0; index < 12; index += 1) {
        const name = format.format(new Date(Date.UTC(2026, index, 15))).toLowerCase().replace(/\.$/, "");
        names.set(name, index + 1);
      }
    }
  }
  // "Sept" is common in British writing and Intl gives "Sep".
  names.set("sept", 9);
  return names;
}

const two = (n: number) => String(n).padStart(2, "0");

function valid(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCMonth() !== month - 1) return null;
  return `${year}-${two(month)}-${two(day)}`;
}

/** The stored form (YYYY-MM-DD) of what was typed, or null if it is not a date. */
export function parseTypedDate(text: string, order: DayOrder, language = "en-GB"): string | null {
  const typed = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!typed) return null;

  // The stored form, always unambiguous.
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(typed);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // A month in words, in English or the reader's language.
  const names = monthNames(["en-GB", language]);
  const words = typed.split(/[\s./-]+/);
  const named = words.findIndex((word) => names.has(word.replace(/\.$/, "")));
  if (named >= 0) {
    const month = names.get(words[named].replace(/\.$/, ""))!;
    const numbers = words.filter((_, index) => index !== named).map(Number);
    if (numbers.length !== 2 || numbers.some(Number.isNaN)) return null;
    const [a, b] = numbers;
    return a > 31 ? valid(a, month, b) : valid(b, month, a);
  }

  // Numbers only.
  const parts = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/.exec(typed);
  if (!parts) return null;
  const [first, second, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  return order === "mdy" ? valid(year, first, second) : valid(year, second, first);
}

/** The order a locale writes day, month and year in. */
export function orderOf(locale: string): DayOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" })
      .formatToParts(new Date(Date.UTC(2026, 9, 28)))
      .map((part) => part.type)
      .filter((type) => type === "day" || type === "month" || type === "year");
    if (parts[0] === "year") return "ymd";
    return parts[0] === "month" ? "mdy" : "dmy";
  } catch {
    return "dmy";
  }
}
