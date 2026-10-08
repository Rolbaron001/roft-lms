/**
 * How dates are written, everywhere on the platform (Roland, 8 October 2026:
 * "Like Clock, please add a Date setting under Settings so that the
 * Administrator can alter how dates appear. Else link it to a user's
 * Windows/Mac settings").
 *
 * Before this, dates were written six different ways: most often as the raw
 * stored form, 2026-10-08, and elsewhere as 08 October 2026, 2026/10/08 or
 * 8 Oct. One function now writes every date, in the provider's chosen style.
 *
 * Imports nothing, so a component in the browser can use it without pulling
 * the database driver into the page.
 */

export const DATE_STYLES = ["long", "numeric", "iso", "device"] as const;
export type DateStyle = (typeof DATE_STYLES)[number];
export const DEFAULT_DATE_STYLE: DateStyle = "long";

export function isDateStyle(value: unknown): value is DateStyle {
  return typeof value === "string" && (DATE_STYLES as readonly string[]).includes(value);
}

export type DateWriter = {
  /** A day: "8 October 2026", or "8 Oct 2026" where space is short. */
  day: (value: Date | string | null | undefined, options?: { short?: boolean; weekday?: boolean }) => string;
  /** A moment: the day, then the time on the provider's clock, "8 October 2026, 14:30". */
  when: (value: Date | string | null | undefined, options?: { short?: boolean }) => string;
};

/**
 * A stored calendar date ("2026-10-08") is a day, not an instant: it is read
 * and written in UTC so that no zone can move it to the day before.
 */
function parse(value: Date | string): { at: Date; calendar: boolean } | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { at: value, calendar: false };
  const calendar = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const at = new Date(calendar ? `${value}T00:00:00Z` : value);
  return Number.isNaN(at.getTime()) ? null : { at, calendar };
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * @param style    the provider's choice
 * @param language the tag the reader's words are written in (dateLocale), so
 *                 a month is named in their language
 * @param device   for "device": the reader's own regional setting, as their
 *                 browser reports it (which follows Windows or macOS)
 * @param timeZone the provider's clock, for instants
 */
export function dateWriter(style: DateStyle, language: string, device: string | null, timeZone: string): DateWriter {
  function day(value: Date | string | null | undefined, options: { short?: boolean; weekday?: boolean } = {}): string {
    if (value === null || value === undefined || value === "") return "";
    const parsed = parse(value);
    if (!parsed) return String(value);
    const zone = parsed.calendar ? "UTC" : timeZone;
    const weekday = options.weekday ? { weekday: options.short ? ("short" as const) : ("long" as const) } : {};

    if (style === "iso" || style === "numeric") {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed.at);
      const part = (type: string) => Number(parts.find((one) => one.type === type)?.value ?? "0");
      const written = style === "iso" ? `${part("year")}-${two(part("month"))}-${two(part("day"))}` : `${two(part("day"))}/${two(part("month"))}/${part("year")}`;
      return options.weekday
        ? `${new Intl.DateTimeFormat(language, { timeZone: zone, ...weekday }).format(parsed.at)} ${written}`
        : written;
    }

    // English is written the British way (Roland, 8 October 2026: King's
    // English): "8 Oct 2026", where South African English pads it to "08 Oct".
    const tag = style === "device" && device ? device : /^en\b/i.test(language) ? "en-GB" : language;
    try {
      return new Intl.DateTimeFormat(tag, {
        timeZone: zone,
        ...weekday,
        ...(style === "device"
          ? options.weekday
            ? { year: "numeric", month: options.short ? "short" : "long", day: "numeric" }
            : { dateStyle: options.short ? "medium" : "long" }
          : { day: "numeric", month: options.short ? "short" : "long", year: "numeric" }),
      }).format(parsed.at);
    } catch {
      return new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "long", year: "numeric" }).format(parsed.at);
    }
  }

  function when(value: Date | string | null | undefined, options: { short?: boolean } = {}): string {
    if (value === null || value === undefined || value === "") return "";
    const parsed = parse(value);
    if (!parsed) return String(value);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(parsed.at);
    return `${day(parsed.at, options)}, ${time}`;
  }

  return { day, when };
}

/**
 * A date inside a message the server writes in English and the reader's
 * language takes over afterwards (lib/i18n/said.ts): always the default style,
 * "8 October 2026", so those messages read alike whatever page shows them.
 */
export function writtenDay(value: Date | string | null | undefined): string {
  return dateWriter(DEFAULT_DATE_STYLE, "en-GB", null, "Africa/Johannesburg").day(value);
}

/** The reader's regional setting from their browser's Accept-Language header. */
export function deviceLocale(acceptLanguage: string | null | undefined): string | null {
  const first = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim();
  if (!first || first === "*") return null;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([first]).length > 0 ? first : null;
  } catch {
    return null;
  }
}
