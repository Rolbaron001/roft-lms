import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  clockInZone,
  isSupportedTimeZone,
  offsetMinutesAt,
  supportedTimeZones,
  zoneLabel,
  zonedTimeToUtc,
} from "@/lib/timezone";

describe("offsetMinutesAt", () => {
  it("reads a zone that does not move", () => {
    // South Africa has observed the same offset since 1944.
    const summer = offsetMinutesAt(DEFAULT_TIME_ZONE, new Date("2026-01-15T12:00:00Z"));
    const winter = offsetMinutesAt(DEFAULT_TIME_ZONE, new Date("2026-07-15T12:00:00Z"));
    expect(summer).toBe(120);
    expect(winter).toBe(120);
  });

  /**
   * The whole reason a tenant record holds a zone rather than a number. A
   * provider in London is +0 in January and +60 in July, and a stored offset is
   * therefore wrong for half of every year.
   */
  it("follows a zone that does move", () => {
    expect(offsetMinutesAt("Europe/London", new Date("2026-01-15T12:00:00Z"))).toBe(0);
    expect(offsetMinutesAt("Europe/London", new Date("2026-07-15T12:00:00Z"))).toBe(60);
  });

  it("reads zones behind UTC as negative", () => {
    expect(
      offsetMinutesAt("America/New_York", new Date("2026-01-15T12:00:00Z")),
    ).toBe(-300);
  });

  it("handles a zone that is not a whole number of hours", () => {
    expect(offsetMinutesAt("Asia/Kolkata", new Date("2026-01-15T12:00:00Z"))).toBe(330);
  });
});

describe("zonedTimeToUtc", () => {
  it("turns a timetable entry into an instant", () => {
    expect(
      zonedTimeToUtc("2026-03-10", "09:00", DEFAULT_TIME_ZONE).toISOString(),
    ).toBe("2026-03-10T07:00:00.000Z");
  });

  it("keeps a wall-clock time fixed across a clock change", () => {
    // 09:00 both times, an hour apart in absolute terms.
    expect(zonedTimeToUtc("2026-03-01", "09:00", "Europe/London").toISOString()).toBe(
      "2026-03-01T09:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-06-01", "09:00", "Europe/London").toISOString()).toBe(
      "2026-06-01T08:00:00.000Z",
    );
  });

  /**
   * The two-pass correction. A single pass using the offset at the naive time
   * lands an hour out on the day the clocks go forward, because it applies the
   * winter offset to a summer time.
   */
  it("is correct on the morning the clocks change", () => {
    // UK clocks go forward at 01:00 UTC on 29 March 2026. A 10:00 session that
    // morning is already on summer time.
    expect(zonedTimeToUtc("2026-03-29", "10:00", "Europe/London").toISOString()).toBe(
      "2026-03-29T09:00:00.000Z",
    );
  });

  it("treats a missing time as midnight", () => {
    expect(zonedTimeToUtc("2026-03-10", null, "UTC").toISOString()).toBe(
      "2026-03-10T00:00:00.000Z",
    );
  });

  /**
   * A round trip is the property that actually matters: whatever a provider
   * typed into the timetable is what the platform shows back to them.
   */
  it("round-trips through the provider's clock", () => {
    for (const zone of ["Africa/Johannesburg", "Europe/London", "America/New_York", "Asia/Kolkata"]) {
      for (const date of ["2026-01-14", "2026-07-14"]) {
        const instant = zonedTimeToUtc(date, "09:00", zone);
        expect(clockInZone(instant, zone)).toBe("09:00");
      }
    }
  });
});

describe("isSupportedTimeZone", () => {
  it("accepts a real zone and refuses anything else", () => {
    expect(isSupportedTimeZone("Africa/Johannesburg")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
    expect(isSupportedTimeZone("Middle/Earth")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
  });

  it("agrees with every zone offered in the picker", () => {
    const zones = supportedTimeZones();
    expect(zones.length).toBeGreaterThan(0);
    expect(zones).toContain(DEFAULT_TIME_ZONE);
    expect(zones.every(isSupportedTimeZone)).toBe(true);
  });
});

describe("zoneLabel", () => {
  it("prefers a real abbreviation over a bare offset", () => {
    // en-GB alone calls this "GMT+2"; en-ZA knows the name.
    expect(zoneLabel("Africa/Johannesburg", new Date("2026-01-15T12:00:00Z"))).toBe(
      "SAST",
    );
  });

  it("follows the season where the name changes", () => {
    expect(zoneLabel("Europe/London", new Date("2026-01-15T12:00:00Z"))).toBe("GMT");
    expect(zoneLabel("Europe/London", new Date("2026-07-15T12:00:00Z"))).toBe("BST");
  });

  it("finds a name that only one of the tried locales knows", () => {
    // en-GB calls this "GMT+5:30"; en-IN knows it as IST.
    expect(zoneLabel("Asia/Kolkata", new Date("2026-01-15T12:00:00Z"))).toBe("IST");
  });

  /**
   * The point of the label, whatever it turns out to be: never render a bare
   * time. Every zone must produce either an abbreviation or an unambiguous
   * offset, and never an empty string.
   */
  it("always labels a zone with something a reader can act on", () => {
    const instant = new Date("2026-07-15T12:00:00Z");
    for (const zone of supportedTimeZones()) {
      const label = zoneLabel(zone, instant);
      expect(label).not.toBe("");
      expect(label).toMatch(/^([A-Za-z+\-0-9]{2,7}|(GMT|UTC)[+-]\d{1,2}(:\d{2})?)$/);
    }
  });
});
