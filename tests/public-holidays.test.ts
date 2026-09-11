/**
 * Public holidays, and the working-day deadlines that depend on them.
 *
 * Checked against published dates rather than against the function's own
 * output. Easter in particular is worth pinning to real years: a computus with
 * a transposed term still returns a plausible spring Sunday, and would go
 * unnoticed against a test that only asked whether the answer looked like a
 * date.
 */
import { describe, expect, it } from "vitest";
import {
  easterSunday,
  holidayDates,
  holidaysAround,
  southAfricanHolidays,
} from "@/lib/public-holidays";
import { addWorkingDays, workingDaysBetween } from "@/lib/working-days";

describe("Easter, which moves", () => {
  // Published dates for Easter Sunday. If the computus is wrong these fail.
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2030, "2030-04-21"],
  ])("is right for %i", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it("puts Good Friday two days before and Family Day the day after", () => {
    const holidays = southAfricanHolidays(2026);
    const named = Object.fromEntries(holidays.map((h) => [h.name, h.date]));

    expect(named["Good Friday"]).toBe("2026-04-03");
    expect(named["Family Day"]).toBe("2026-04-06");
  });
});

describe("the South African calendar", () => {
  it("carries the twelve the Act names", () => {
    const names = southAfricanHolidays(2026).map((h) => h.name);

    for (const expected of [
      "New Year's Day",
      "Human Rights Day",
      "Good Friday",
      "Family Day",
      "Freedom Day",
      "Workers' Day",
      "Youth Day",
      "National Women's Day",
      "Heritage Day",
      "Day of Reconciliation",
      "Christmas Day",
      "Day of Goodwill",
    ]) {
      expect(names, `${expected} is missing`).toContain(expected);
    }
  });

  /**
   * Section 2(1) of the Public Holidays Act: a holiday on a Sunday makes the
   * Monday one too. In 2027 Boxing Day falls on a Sunday.
   */
  it("adds the Monday when a holiday falls on a Sunday", () => {
    const dates = southAfricanHolidays(2027).map((h) => h.date);

    expect(dates).toContain("2027-12-26"); // the Sunday itself
    expect(dates).toContain("2027-12-27"); // and the Monday that follows
  });

  /**
   * 9 August 2026 is a Sunday, so Women's Day is observed on the Monday. An
   * earlier version of this test asserted no observed day in 2026 at all,
   * which was simply wrong about the calendar - checked against `date` rather
   * than against the function under test.
   */
  it("observes Women's Day on the Monday in 2026", () => {
    const observed = southAfricanHolidays(2026).filter((h) =>
      h.name.includes("observed"),
    );

    expect(observed).toEqual([
      { date: "2026-08-10", name: "National Women's Day (observed)" },
    ]);
  });

  /**
   * Stated as the rule rather than as a year with no Sundays in it. Two
   * earlier attempts here named a year and were wrong about it both times -
   * 9 August 2026 and 24 September 2028 are both Sundays. Asserting the rule
   * over a twenty-year span cannot be wrong in that way, and covers far more
   * calendar than a hand-picked year would.
   */
  it("adds a Monday for every Sunday holiday and for nothing else", () => {
    for (let year = 2024; year <= 2044; year += 1) {
      const holidays = southAfricanHolidays(year);
      const sundays = holidays.filter(
        (h) =>
          !h.name.includes("observed") &&
          new Date(`${h.date}T00:00:00Z`).getUTCDay() === 0,
      );
      const observed = holidays.filter((h) => h.name.includes("observed"));

      expect(observed, `${year} has the wrong number of observed days`)
        .toHaveLength(sundays.length);

      for (const day of observed) {
        // Each observed day is the Monday after the Sunday it stands in for.
        expect(new Date(`${day.date}T00:00:00Z`).getUTCDay()).toBe(1);
      }
    }
  });

  it("is sorted, so a reader can scan it", () => {
    const dates = southAfricanHolidays(2026).map((h) => h.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("a deadline that runs over a holiday", () => {
  /**
   * The bug this file exists to prevent. Counting a holiday as a working day
   * reaches the twenty-first working day on an earlier calendar date than the
   * true one - so the platform would call a window closed while it was open.
   */
  it("lands later once holidays are counted", () => {
    // Induction on 1 December 2026. Sixteen December and Christmas fall inside
    // the twenty-one working days that follow.
    const withoutHolidays = addWorkingDays("2026-12-01", 21);
    const withHolidays = addWorkingDays(
      "2026-12-01",
      21,
      holidaysAround("ZA", "2026-12-01"),
    );

    expect(withHolidays > withoutHolidays).toBe(true);
  });

  it("counts the right number of them over the December run", () => {
    // 16 Dec, 25 Dec, 26 Dec and 1 Jan all fall in this window.
    const holidays = holidaysAround("ZA", "2026-12-01");
    const inWindow = holidays.filter((d) => d >= "2026-12-01" && d <= "2027-01-15");

    expect(inWindow).toEqual([
      "2026-12-16",
      "2026-12-25",
      "2026-12-26",
      "2027-01-01",
    ]);
  });

  /**
   * A deadline set in December runs into January, so a holiday list that
   * stopped at the year end would silently treat New Year's Day as a working
   * day. `holidaysAround` spans the years either side for that reason.
   */
  it("spans the year end", () => {
    const dates = holidaysAround("ZA", "2026-12-28");

    expect(dates).toContain("2026-12-26");
    expect(dates).toContain("2027-01-01");
  });

  it("leaves a deadline nowhere near a holiday unchanged", () => {
    const plain = addWorkingDays("2026-02-02", 5);
    const withHolidays = addWorkingDays(
      "2026-02-02",
      5,
      holidaysAround("ZA", "2026-02-02"),
    );

    expect(withHolidays).toBe(plain);
  });

  it("shortens the count between two dates across a holiday", () => {
    const plain = workingDaysBetween("2026-12-15", "2026-12-18");
    const real = workingDaysBetween(
      "2026-12-15",
      "2026-12-18",
      holidaysAround("ZA", "2026-12-15"),
    );

    // 16 December is a holiday, so one fewer working day separates them.
    expect(real).toBe(plain - 1);
  });
});

describe("other countries", () => {
  it("asks for a calendar by name rather than assuming South Africa", () => {
    const dates = holidayDates("ZA", 2026, 2026);
    expect(dates.length).toBeGreaterThan(10);
    expect(dates.every((d) => d.startsWith("2026"))).toBe(true);
  });
});

/**
 * The wiring, not the arithmetic.
 *
 * The calculation above is pure and well covered. What this checks is that a
 * tenant actually gets its calendar - the step that was missing entirely until
 * now, and the one that no amount of testing `addWorkingDays` would have
 * caught, because the function was always right and simply never told.
 */
describe("a tenant's own calendar", () => {
  it("gives South Africa's holidays to a tenant that keeps them", async () => {
    const { withPlatformScope } = await import("@/db/client");
    const { organisations } = await import("@/db/schema");
    const { holidaysForTenant, calendarFor } = await import(
      "@/lib/tenant-holidays"
    );
    const { eq } = await import("drizzle-orm");

    const slug = `holiday-${Date.now()}`;
    const organisationId = await withPlatformScope("holiday fixture", async (tx) => {
      const [row] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Holiday Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });
      return row.id;
    });

    try {
      // South Africa by default, because that is where the first tenants are.
      expect(await calendarFor(organisationId)).toBe("ZA");

      const holidays = await holidaysForTenant(organisationId, "2026-12-01");
      expect(holidays).toContain("2026-12-16");
      expect(holidays).toContain("2027-01-01");

      const { addWorkingDays } = await import("@/lib/working-days");
      expect(addWorkingDays("2026-12-01", 21, holidays)).not.toBe(
        addWorkingDays("2026-12-01", 21),
      );
    } finally {
      await withPlatformScope("holiday teardown", (tx) =>
        tx.delete(organisations).where(eq(organisations.id, organisationId)),
      );
    }
  });
});
