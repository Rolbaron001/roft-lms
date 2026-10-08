/**
 * How dates are written (Roland, 8 October 2026): one function for the whole
 * platform, in the provider's chosen style.
 */
import { describe, expect, it } from "vitest";
import { dateWriter, deviceLocale, isDateStyle, writtenDay } from "@/lib/date-format";

const zone = "Africa/Johannesburg";

describe("writing a date", () => {
  it("writes each style the provider can choose", () => {
    expect(dateWriter("long", "en-ZA", null, zone).day("2026-10-08")).toBe("8 October 2026");
    expect(dateWriter("long", "en-ZA", null, zone).day("2026-10-08", { short: true })).toBe("8 Oct 2026");
    expect(dateWriter("numeric", "en-ZA", null, zone).day("2026-10-08")).toBe("08/10/2026");
    expect(dateWriter("iso", "en-ZA", null, zone).day("2026-10-08")).toBe("2026-10-08");
  });

  it("follows the reader's own regional setting when told to", () => {
    expect(dateWriter("device", "en-ZA", "en-US", zone).day("2026-10-08")).toBe("October 8, 2026");
    expect(dateWriter("device", "en-ZA", "en-GB", zone).day("2026-10-08")).toBe("8 October 2026");
    // No setting reported: the reader's language instead.
    expect(dateWriter("device", "en-GB", null, zone).day("2026-10-08")).toBe("8 October 2026");
  });

  it("never moves a calendar date to the day before, whatever the clock", () => {
    expect(dateWriter("long", "en-GB", null, "America/Los_Angeles").day("2026-10-08")).toBe("8 October 2026");
  });

  it("writes a moment on the provider's clock, in the 24-hour clock", () => {
    const at = new Date("2026-10-08T22:30:00Z");
    expect(dateWriter("long", "en-GB", null, zone).when(at)).toBe("9 October 2026, 00:30");
  });

  it("names the month in the reader's language", () => {
    expect(dateWriter("long", "af-ZA", null, zone).day("2026-10-08")).toMatch(/Oktober/);
  });

  it("leaves nothing in place of an empty date", () => {
    expect(dateWriter("long", "en-GB", null, zone).day(null)).toBe("");
    expect(writtenDay(undefined)).toBe("");
  });

  it("writes server messages in the default style", () => {
    expect(writtenDay("2026-03-14")).toBe("14 March 2026");
  });

  it("knows the styles and reads the browser's setting", () => {
    expect(isDateStyle("long")).toBe(true);
    expect(isDateStyle("american")).toBe(false);
    expect(deviceLocale("en-GB,en;q=0.9")).toBe("en-GB");
    expect(deviceLocale(null)).toBeNull();
  });
});
