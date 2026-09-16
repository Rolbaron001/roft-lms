/**
 * Not reporting a fault where there is none.
 *
 * Heidi Els, 16 September 2026, asked for Curiosa's EISA sitting dates: "We
 * cannot give sitting dates because they change every year and are only
 * released in December of each year."
 *
 * The screen had been saying "No sittings recorded. Add the dates from the
 * assessment quality partner's letter and the countdown starts" — which reads
 * as an instruction somebody has ignored. For most of the year the dates do
 * not exist for anybody to add, and a platform that reports a fault where
 * there is none teaches people to ignore what it reports.
 */
import { describe, expect, it } from "vitest";
import {
  DATES_PUBLISHED_IN_MONTH,
  shouldAskForNextYear,
  sittingDatesNotice,
} from "@/lib/eisa-sitting-notice";

describe("when no sittings are held at all", () => {
  it("does not suggest somebody was slack, mid-year", () => {
    const notice = sittingDatesNotice("2026-07-14");

    expect(notice.year).toBe(2026);
    expect(notice.text).toContain("change every year");
    // The mid-year notice explains; it does not instruct.
    expect(notice.text).not.toContain("should be out");
  });

  it("says the letter should be out, in December", () => {
    const notice = sittingDatesNotice("2026-12-03");

    // December talks about the year ahead, which is what the letter covers.
    expect(notice.year).toBe(2027);
    expect(notice.text).toContain("2027");
    expect(notice.text).toContain("should be out");
  });

  it("still says what the absence costs, so it is not shrugged off", () => {
    // The point is not to be reassuring. Without dates the countdown that
    // stops a cohort missing a registration deadline cannot run, and somebody
    // reading this screen has to know that.
    const notice = sittingDatesNotice("2026-05-01");

    expect(notice.text).toContain("registration deadline");
  });

  it("says something neutral rather than guessing, on an unreadable date", () => {
    const notice = sittingDatesNotice("not-a-date");

    expect(notice.expected).toBe(false);
    expect(notice.text).toContain("once a year");
  });
});

describe("asking for next year, when this year is in hand", () => {
  const thisYear = ["2026-04-20", "2026-09-14"];

  it("says nothing before the letter is published", () => {
    expect(shouldAskForNextYear("2026-09-16", thisYear)).toBe(false);
    expect(shouldAskForNextYear("2026-11-30", thisYear)).toBe(false);
  });

  it("asks once December comes", () => {
    expect(shouldAskForNextYear("2026-12-01", thisYear)).toBe(true);
  });

  it("stops asking as soon as next year is entered", () => {
    expect(
      shouldAskForNextYear("2026-12-20", [...thisYear, "2027-03-11"]),
    ).toBe(false);
  });

  /**
   * The month is a convention, not a rule. The next provider's quality partner
   * may publish in October, and the only thing that should need changing is
   * the constant.
   */
  it("turns on the month the dates are published, whatever that is", () => {
    expect(DATES_PUBLISHED_IN_MONTH).toBe(12);

    const month = String(DATES_PUBLISHED_IN_MONTH).padStart(2, "0");
    expect(shouldAskForNextYear(`2026-${month}-05`, thisYear)).toBe(true);
  });
});
