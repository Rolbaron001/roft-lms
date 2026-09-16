/**
 * What to say when no EISA sittings are recorded.
 *
 * Heidi Els, 16 September 2026, asked for Curiosa's sitting dates: "We cannot
 * give sitting dates because they change every year and are only released in
 * December of each year."
 *
 * That is not a missing answer, it is the answer, and it changes what the
 * screen should say. The empty state read "No sittings recorded. Add the dates
 * from the assessment quality partner's letter and the countdown starts" —
 * which is fair in January and an accusation in July, when the dates for next
 * year do not exist for anybody to add. A platform that reports a fault where
 * there is none teaches people to ignore what it reports.
 *
 * So the year is split the way the assessment quality partner splits it. Until
 * the letter is published there is nothing anybody can do and the screen says
 * so. Once it is out, the dates exist and their absence is worth chasing.
 *
 * Pure, and imports nothing. The month it turns on is a convention rather than
 * a rule, so it is named once here and can be moved without hunting through a
 * screen.
 */

/**
 * The month the dates for the following year are published.
 *
 * December, per Heidi. Written as a constant rather than the number 12 in a
 * comparison, because the next provider's quality partner may well publish in
 * October and the only thing that should need changing is this line.
 */
export const DATES_PUBLISHED_IN_MONTH = 12;

export type SittingNotice = {
  /** Which year's dates are being talked about. */
  year: number;
  /** True once the dates ought to exist, so absence is worth chasing. */
  expected: boolean;
  text: string;
};

/**
 * The notice for a tenant holding no open sittings, as at a given date.
 *
 * `asAt` is an ISO date. Taken as an argument rather than read from the clock
 * so that the December behaviour can be tested without waiting for December.
 */
export function sittingDatesNotice(asAt: string): SittingNotice {
  const [yearPart, monthPart] = asAt.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    // An unreadable date is not worth an opinion about. Say the neutral thing.
    return {
      year: 0,
      expected: false,
      text: "No sittings are recorded. They come from the assessment quality partner's letter, which is published once a year.",
    };
  }

  // From December, the coming year's letter is out; before it, the dates for
  // that year do not exist yet.
  const publishedForNextYear = month >= DATES_PUBLISHED_IN_MONTH;
  const subject = publishedForNextYear ? year + 1 : year;

  if (publishedForNextYear) {
    return {
      year: subject,
      expected: true,
      text: `No sittings are recorded for ${subject}. The assessment quality partner publishes the dates in December, so the letter should be out — add them and the countdown starts.`,
    };
  }

  return {
    year: subject,
    expected: true,
    text: `No sittings are recorded for ${subject}. The dates come from the assessment quality partner's letter and change every year. Until they are entered, nothing here can warn you that a registration deadline is coming.`,
  };
}

/**
 * Whether to ask for next year's dates, given what is already held.
 *
 * Separate from the notice above because it answers a different question: that
 * one is for a tenant with nothing at all, this is for one whose current year
 * is in hand and whose next year is not. December is when that becomes worth
 * saying, and saying it in July would be nagging about a letter nobody has.
 */
export function shouldAskForNextYear(
  asAt: string,
  sittingDates: string[],
): boolean {
  const [yearPart, monthPart] = asAt.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return false;

  if (month < DATES_PUBLISHED_IN_MONTH) return false;

  const next = String(year + 1);
  return !sittingDates.some((date) => date.startsWith(next));
}
