import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { organisations } from "@/db/schema";
import {
  HOLIDAY_CALENDARS,
  holidaysAround,
  type HolidayCalendar,
} from "./public-holidays";

/**
 * The public holidays a given tenant's deadlines observe.
 *
 * Split from `lib/public-holidays.ts` so that the calculation stays pure and
 * usable in a browser, while the part that needs to know which tenant is asking
 * lives here with the database.
 *
 * Cached for the life of the request rather than per call: a page that shows
 * thirty learners' deadlines would otherwise ask the same question thirty
 * times, and a tenant's calendar does not change between two rows of a table.
 */
const cache = new Map<string, HolidayCalendar>();

function knownCalendar(value: string): HolidayCalendar {
  return value in HOLIDAY_CALENDARS ? (value as HolidayCalendar) : "ZA";
}

/** Which calendar this tenant keeps. */
export async function calendarFor(
  organisationId: string,
): Promise<HolidayCalendar> {
  const held = cache.get(organisationId);
  if (held) return held;

  const calendar = await withTenant(organisationId, async (tx) => {
    const [row] = await tx
      .select({ holidayCalendar: organisations.holidayCalendar })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    return knownCalendar(row?.holidayCalendar ?? "ZA");
  });

  cache.set(organisationId, calendar);
  return calendar;
}

/**
 * The holidays around a date, for this tenant.
 *
 * Pass the result straight to `addWorkingDays` or `workingDaysBetween`. The
 * span covers the years either side, because a deadline set in December runs
 * into January and a list that stopped at the year end would count New Year's
 * Day as a working day.
 */
export async function holidaysForTenant(
  organisationId: string,
  isoDate: string,
): Promise<string[]> {
  return holidaysAround(await calendarFor(organisationId), isoDate);
}

/** Dropped when a tenant's calendar changes, so the next read is fresh. */
export function forgetCalendar(organisationId: string): void {
  cache.delete(organisationId);
}
