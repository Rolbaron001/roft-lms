/**
 * Working days.
 *
 * Nearly every deadline in the client's procedures is counted in working days
 * rather than hours: an appeal lodged "within two working days of receiving
 * results", a grievance acknowledged "within 2 working days", a hearing
 * decided "within 7-10 working days". Counting those in calendar days would
 * make a Friday result and a Monday result mean different things, and the
 * difference falls on the learner.
 *
 * Weekends are excluded here. Public holidays are passed in rather than known,
 * because they are neither universal nor stable: South Africa has its own set,
 * they move, and a tenant elsewhere has a different set entirely. Until a
 * tenant can keep its own calendar, callers pass none and a deadline that
 * lands on a public holiday is a day tighter than the procedure intends. That
 * is the safe direction to be wrong in - it never makes a deadline later than
 * the learner was promised - and it is noted in the queue.
 *
 * Dates are handled as plain "YYYY-MM-DD" strings on the provider's calendar,
 * not as instants. A working day is a thing on a wall calendar; converting to
 * a timestamp and back only invites a zone to shift it across midnight.
 *
 * This module imports nothing, so a client component can use it.
 */

/** Saturday or Sunday on the provider's calendar. */
export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** A day that counts: not a weekend, not on the holiday list given. */
export function isWorkingDay(isoDate: string, holidays: string[] = []): boolean {
  return !isWeekend(isoDate) && !holidays.includes(isoDate);
}

function shift(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The date `count` working days after `isoDate`.
 *
 * The starting day is not counted, whether or not it is itself a working day.
 * "Two working days after receiving results" means two whole days in which to
 * act, and a result received on Friday afternoon gives Monday and Tuesday.
 */
export function addWorkingDays(
  isoDate: string,
  count: number,
  holidays: string[] = [],
): string {
  if (count <= 0) return isoDate;

  let cursor = isoDate;
  let remaining = count;
  // Bounded so a caller passing a nonsense count cannot spin forever.
  let guard = count * 7 + 14;

  while (remaining > 0 && guard-- > 0) {
    cursor = shift(cursor, 1);
    if (isWorkingDay(cursor, holidays)) remaining -= 1;
  }

  return cursor;
}

/**
 * How many working days from one date to another, counting neither endpoint's
 * start. Negative when `to` is before `from`.
 */
export function workingDaysBetween(
  fromIso: string,
  toIso: string,
  holidays: string[] = [],
): number {
  if (fromIso === toIso) return 0;

  const backwards = toIso < fromIso;
  const [start, end] = backwards ? [toIso, fromIso] : [fromIso, toIso];

  let cursor = start;
  let days = 0;
  let guard = 4000;

  while (cursor < end && guard-- > 0) {
    cursor = shift(cursor, 1);
    if (isWorkingDay(cursor, holidays)) days += 1;
  }

  return backwards ? -days : days;
}

/**
 * Whether something done on `doneIso` met a deadline of `count` working days
 * from `fromIso`, and by how much it missed.
 *
 * Returned together because every caller needs both: one to decide, and one to
 * say so in the sentence a person reads.
 */
export function withinWorkingDays(input: {
  from: string;
  done: string;
  count: number;
  holidays?: string[];
}): { deadline: string; inTime: boolean; lateByWorkingDays: number } {
  const holidays = input.holidays ?? [];
  const deadline = addWorkingDays(input.from, input.count, holidays);
  const inTime = input.done <= deadline;

  return {
    deadline,
    inTime,
    lateByWorkingDays: inTime
      ? 0
      : workingDaysBetween(deadline, input.done, holidays),
  };
}
