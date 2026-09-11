/**
 * Public holidays, so that a working-day deadline means what the law means.
 *
 * `lib/working-days.ts` takes holidays as an argument and says so in its own
 * comment: "Weekends are excluded here. Public holidays are passed in rather
 * than known." Nothing was passing any. Every deadline in the platform - the
 * days to appeal a sanction, the days to acknowledge a grievance, and now the
 * statutory notification clock - was counting Christmas Day as a working day.
 *
 * That error runs in the dangerous direction. Counting a holiday as a working
 * day reaches the twenty-first working day on an *earlier* calendar date than
 * the true one, so the platform would call an appeal window closed while it was
 * still open, and report a notification overdue while there was still time.
 *
 * Two rules from the Public Holidays Act, 1994 make this more than a list:
 *
 *   Easter moves, so Good Friday and Family Day have to be computed rather
 *   than tabulated.
 *
 *   "Whenever any public holiday falls on a Sunday, the following Monday shall
 *   be a public holiday" - section 2(1). Ignoring that loses a day roughly
 *   every other year.
 *
 * South Africa is the default and not the assumption: the platform is
 * multi-tenant, and a Namibian or Kenyan provider keeps its own list. Which is
 * why the country is a property of the tenant and the dates are seeded rather
 * than hardcoded into the arithmetic.
 *
 * Pure on purpose - no imports, no database - so a form can work out a deadline
 * in the browser without dragging the Postgres driver in with it.
 */

export type PublicHoliday = { date: string; name: string };

/**
 * Easter Sunday, by the anonymous Gregorian computus.
 *
 * Written out rather than pulled from a library because a date library is a
 * large dependency for one calculation, and this one has been stable since
 * 1583. Returns an ISO date.
 */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return iso(year, month, day);
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function isSunday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

/**
 * South Africa's public holidays for one year, including the Monday rule.
 *
 * The twelve named in the Act, plus Good Friday and Family Day either side of
 * Easter. Days of national mourning and once-off holidays - an election day,
 * say - are not here and cannot be: they are proclaimed, not calculated. A
 * tenant adds those to its own list.
 */
export function southAfricanHolidays(year: number): PublicHoliday[] {
  const easter = easterSunday(year);

  const base: PublicHoliday[] = [
    { date: iso(year, 1, 1), name: "New Year's Day" },
    { date: shiftDays(easter, -2), name: "Good Friday" },
    { date: shiftDays(easter, 1), name: "Family Day" },
    { date: iso(year, 3, 21), name: "Human Rights Day" },
    { date: iso(year, 4, 27), name: "Freedom Day" },
    { date: iso(year, 5, 1), name: "Workers' Day" },
    { date: iso(year, 6, 16), name: "Youth Day" },
    { date: iso(year, 8, 9), name: "National Women's Day" },
    { date: iso(year, 9, 24), name: "Heritage Day" },
    { date: iso(year, 12, 16), name: "Day of Reconciliation" },
    { date: iso(year, 12, 25), name: "Christmas Day" },
    { date: iso(year, 12, 26), name: "Day of Goodwill" },
  ];

  /**
   * Section 2(1): a public holiday falling on a Sunday moves the following
   * Monday into the holiday too. Good Friday and Family Day are exempt in
   * practice - neither can fall on a Sunday - so the rule is applied to the
   * whole list without a special case.
   */
  const observed: PublicHoliday[] = [];
  for (const holiday of base) {
    observed.push(holiday);
    if (isSunday(holiday.date)) {
      observed.push({
        date: shiftDays(holiday.date, 1),
        name: `${holiday.name} (observed)`,
      });
    }
  }

  return observed.sort((a, b) => a.date.localeCompare(b.date));
}

/** The countries the platform knows a holiday calendar for. */
export const HOLIDAY_CALENDARS = {
  ZA: { label: "South Africa", forYear: southAfricanHolidays },
} as const;

export type HolidayCalendar = keyof typeof HOLIDAY_CALENDARS;

/**
 * Every holiday across a span of years, as the plain dates `addWorkingDays`
 * wants.
 *
 * A span rather than a year because a deadline set in December runs into
 * January, and a list that stops on the 31st would quietly count New Year's Day
 * as a working day - which is the whole bug this file exists to fix.
 */
export function holidayDates(
  calendar: HolidayCalendar,
  fromYear: number,
  toYear: number = fromYear + 1,
): string[] {
  const dates: string[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const holiday of HOLIDAY_CALENDARS[calendar].forYear(year)) {
      dates.push(holiday.date);
    }
  }
  return dates;
}

/**
 * The holidays that matter for a deadline starting on a given date.
 *
 * Convenience over `holidayDates`, so a caller with one ISO date does not have
 * to work out which years to ask for.
 */
export function holidaysAround(
  calendar: HolidayCalendar,
  isoDate: string,
): string[] {
  const year = Number(isoDate.slice(0, 4));
  return holidayDates(calendar, year - 1, year + 1);
}
