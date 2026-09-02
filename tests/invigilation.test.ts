/**
 * The door, and the clock it is judged against.
 *
 * These two functions decide whether a sitting was run to its own rules, which
 * is what an appeal turns on. They are pure so they can be tested against a
 * fixed clock rather than inferred from behaviour on the day.
 *
 * The rule that matters is not administrative. A candidate admitted late has
 * had longer with the paper than everybody else; a candidate readmitted after
 * dropping out has been unsupervised in between. Both are refusals rather than
 * warnings, because a warning is a thing somebody clicks past at the moment
 * they are busiest.
 */
import { describe, expect, it } from "vitest";
import { admissionOpen, sittingStartsAt } from "@/lib/invigilation";

describe("sittingStartsAt", () => {
  /**
   * The session holds a date and a clock time separately, on purpose, so a
   * sitting at 09:00 stays at 09:00 whatever the server thinks the zone is.
   * Putting them back together needs the provider's zone, which is why it is
   * an argument rather than a guess.
   */
  it("reads the provider's own clock, not the server's", () => {
    // 09:00 in South Africa is 07:00 UTC.
    const sast = sittingStartsAt("2026-03-10", "09:00", "Africa/Johannesburg");
    expect(sast.toISOString()).toBe("2026-03-10T07:00:00.000Z");

    // The same wall-clock time in UTC is a different instant.
    const utc = sittingStartsAt("2026-03-10", "09:00", "UTC");
    expect(utc.toISOString()).toBe("2026-03-10T09:00:00.000Z");
  });

  /**
   * The reason the tenant record holds a zone and not an offset. A provider in
   * London runs a 09:00 sitting at 09:00 all year; the instant that is moves by
   * an hour when the clocks change. An offset of +60 stored in March would
   * refuse admission to everybody arriving on time in December.
   */
  it("follows daylight saving where the provider observes it", () => {
    const winter = sittingStartsAt("2026-01-14", "09:00", "Europe/London");
    expect(winter.toISOString()).toBe("2026-01-14T09:00:00.000Z");

    const summer = sittingStartsAt("2026-07-14", "09:00", "Europe/London");
    expect(summer.toISOString()).toBe("2026-07-14T08:00:00.000Z");
  });

  it("treats a session with no time as starting at midnight", () => {
    expect(sittingStartsAt("2026-03-10", null, "UTC").toISOString()).toBe(
      "2026-03-10T00:00:00.000Z",
    );
  });
});

describe("admissionOpen", () => {
  const startsAt = new Date("2026-03-10T07:00:00.000Z");

  it("admits somebody who is early", () => {
    const result = admissionOpen({
      startsAt,
      closesAfterMinutes: 5,
      now: new Date("2026-03-10T06:45:00.000Z"),
    });
    expect(result.open).toBe(true);
    expect(result.lateBySeconds).toBe(0);
  });

  it("admits somebody who is on time", () => {
    expect(
      admissionOpen({ startsAt, closesAfterMinutes: 5, now: startsAt }).open,
    ).toBe(true);
  });

  it("admits somebody inside the grace period", () => {
    expect(
      admissionOpen({
        startsAt,
        closesAfterMinutes: 5,
        now: new Date("2026-03-10T07:04:59.000Z"),
      }).open,
    ).toBe(true);
  });

  /** The boundary is the rule, so it is stated exactly. */
  it("closes at the last second of the grace period, not after it", () => {
    expect(
      admissionOpen({
        startsAt,
        closesAfterMinutes: 5,
        now: new Date("2026-03-10T07:05:00.000Z"),
      }).open,
    ).toBe(true);

    expect(
      admissionOpen({
        startsAt,
        closesAfterMinutes: 5,
        now: new Date("2026-03-10T07:05:01.000Z"),
      }).open,
    ).toBe(false);
  });

  it("says how late somebody is, so the refusal can say it too", () => {
    const result = admissionOpen({
      startsAt,
      closesAfterMinutes: 5,
      now: new Date("2026-03-10T07:20:00.000Z"),
    });
    expect(result.open).toBe(false);
    expect(result.lateBySeconds).toBe(900);
    expect(result.closedAt.toISOString()).toBe("2026-03-10T07:05:00.000Z");
  });

  /**
   * The cut-off is a provider's policy, not a law, so a tenant with a
   * different rule expresses it without a fork.
   */
  it("honours a provider's own grace period", () => {
    const strict = admissionOpen({
      startsAt,
      closesAfterMinutes: 0,
      now: new Date("2026-03-10T07:00:30.000Z"),
    });
    expect(strict.open).toBe(false);

    const generous = admissionOpen({
      startsAt,
      closesAfterMinutes: 30,
      now: new Date("2026-03-10T07:20:00.000Z"),
    });
    expect(generous.open).toBe(true);
  });
});
