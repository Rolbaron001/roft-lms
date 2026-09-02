/**
 * The provider's clock.
 *
 * A session holds a date and a wall-clock time apart on purpose: "the tenth of
 * March at 09:00" is what a timetable means, and it stays 09:00 whether the
 * server is in Johannesburg, Frankfurt or nowhere in particular. Turning that
 * into an instant needs somebody's zone, and the only defensible answer is the
 * provider's own.
 *
 * A zone, not an offset. An offset of +120 is correct for South Africa forever,
 * because South Africa does not observe daylight saving. It is correct for
 * London for roughly half the year, and an hour wrong for the other half, which
 * is the kind of fault that surfaces as a candidate refused admission to a
 * sitting they arrived on time for. Storing "Africa/Johannesburg" rather than
 * 120 costs nothing today and is the difference between a tenant in Europe
 * working and not.
 *
 * This module imports nothing, so a client component can use it without
 * dragging the database driver into the browser bundle.
 */

/** What a tenant gets if nobody has said otherwise. */
export const DEFAULT_TIME_ZONE = "Africa/Johannesburg";

/**
 * How far ahead of UTC a zone is at a given instant, in minutes.
 *
 * Read out of `Intl` rather than tabulated, because the alternative is
 * shipping a copy of the world's daylight-saving rules and keeping it current.
 * The runtime already has them and updates them with the platform.
 */
export function offsetMinutesAt(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const at = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour"),
    at("minute"),
    at("second"),
  );

  // Seconds, because the formatted parts carry them; rounded to the minute
  // because no zone in current use has a sub-minute offset.
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/**
 * A wall-clock time in a zone, as an instant.
 *
 * Two passes. The first guess uses the offset in force at the naive time, which
 * is right except near a daylight-saving change; the second uses the offset in
 * force at that guess, which corrects it. On the two hours a year that do not
 * resolve — a time that never happened when clocks sprang forward, or happened
 * twice when they fell back — this lands on one of them rather than throwing.
 * A timetable does not schedule lectures at 02:30 on a clock-change Sunday, and
 * refusing to load the page would be the worse failure.
 */
export function zonedTimeToUtc(
  scheduledDate: string,
  wallClockTime: string | null,
  timeZone: string,
): Date {
  const [hours, minutes] = (wallClockTime ?? "00:00").split(":").map(Number);

  const naive = Date.UTC(
    Number(scheduledDate.slice(0, 4)),
    Number(scheduledDate.slice(5, 7)) - 1,
    Number(scheduledDate.slice(8, 10)),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
  );

  const first = naive - offsetMinutesAt(timeZone, new Date(naive)) * 60_000;
  const second = naive - offsetMinutesAt(timeZone, new Date(first)) * 60_000;
  return new Date(second);
}

/** An instant on the provider's clock, as HH:MM. */
export function clockInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

/**
 * Which calendar day an instant falls on, where the provider is.
 *
 * Working-day deadlines are counted on a wall calendar, and "today" at 01:00
 * in Johannesburg is still yesterday in London. Asking the server what day it
 * is would make a deadline depend on where the machine happens to run.
 */
export function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const at = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${at("year")}-${at("month")}-${at("day")}`;
}

/** An instant on the provider's clock, as a date and a time. */
export function stampInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(instant);
}

/**
 * What to call the zone in front of a person: "SAST", or "GMT+2" where the
 * runtime has no short name for it.
 *
 * Every displayed time is labelled with this. An unlabelled time is the whole
 * problem: a learner in London reading "09:00" has no way to know whether that
 * is their morning or somebody else's, and the one who guesses wrong misses
 * the sitting.
 */
export function zoneLabel(timeZone: string, instant: Date = new Date()): string {
  // Whether a zone has a short name like SAST or BST, and whether the runtime
  // will hand it over, depends on the locale asked: en-GB knows BST but calls
  // Johannesburg "GMT+2", while en-ZA says SAST. The abbreviation itself is a
  // property of the zone rather than of the locale, so trying a few and taking
  // the first real name is safe. "GMT+2" is the honest fallback when no locale
  // has one, and is unambiguous even if it is not what a local would say.
  let fallback: string | null = null;

  for (const locale of ["en-ZA", "en-GB", "en-US", "en-AU", "en-IN"]) {
    const name = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "short",
    })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;

    if (name && !/^(GMT|UTC)[+-]/.test(name)) return name;
    if (name && !fallback) fallback = name;
  }

  return (
    fallback ?? timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone
  );
}

/** Whether the runtime recognises this zone. */
export function isSupportedTimeZone(candidate: string): boolean {
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every zone the runtime knows, for the picker.
 *
 * Read from the runtime rather than hard-coded, so the list does not go stale
 * as zones are added and renamed. The fallback is for a runtime built without
 * the full data; it keeps the picker usable rather than empty.
 */
export function supportedTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;

  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      /* fall through */
    }
  }

  return [
    DEFAULT_TIME_ZONE,
    "Africa/Lagos",
    "Africa/Nairobi",
    "Europe/London",
    "Europe/Amsterdam",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Australia/Sydney",
    "America/New_York",
    "America/Los_Angeles",
    "UTC",
  ];
}

/**
 * The zone the person reading is actually in, or null on the server.
 *
 * Used only to show somebody their own local equivalent alongside the
 * provider's time. It never decides anything: the provider's clock is the
 * record, and this is a courtesy so a learner abroad knows when to be there.
 */
export function viewerTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
