/**
 * How long a learner was in a class, and whether that counts as present (job
 * sheet D41). Kept apart from the database so the arithmetic can be checked
 * on its own: a register is evidence, and a rule nobody can test is a rule
 * nobody can defend at a monitoring visit.
 *
 * This module imports nothing.
 */

export type Stay = { joinedAt: Date; leftAt: Date | null };

const MINUTE = 60_000;

/**
 * Minutes in the class between `from` and `to`, adding up every stay and
 * counting time once where stays overlap. Two browser tabs, or a reconnection
 * reported before the old connection's departure, would otherwise count the
 * same minutes twice. A stay still open is counted to `to`.
 */
export function minutesIn(stays: Stay[], from: Date, to: Date): number {
  const spans = stays
    .map((stay) => [Math.max(stay.joinedAt.getTime(), from.getTime()), Math.min((stay.leftAt ?? to).getTime(), to.getTime())] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of spans) {
    if (current && start <= current[1]) {
      current[1] = Math.max(current[1], end);
      continue;
    }
    if (current) total += current[1] - current[0];
    current = [start, end];
  }
  if (current) total += current[1] - current[0];
  return Math.floor(total / MINUTE);
}

/** "18:30" as minutes after midnight, or null. */
function clockMinutes(clock: string | null): number | null {
  if (!clock) return null;
  const [hours, minutes] = clock.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

/**
 * The length a learner's time is measured against: the scheduled length, or
 * the class as held if it was shorter. A facilitator who ends a class early has
 * not made everybody in it absent; one who runs over has not raised the bar.
 */
export function classLength(
  scheduled: { startTime: string | null; endTime: string | null },
  held: { startedAt: Date; endedAt: Date },
): number {
  const actual = Math.max(0, Math.floor((held.endedAt.getTime() - held.startedAt.getTime()) / MINUTE));
  const start = clockMinutes(scheduled.startTime);
  const end = clockMinutes(scheduled.endTime);
  if (start === null || end === null || end <= start) return actual;
  return Math.min(end - start, actual);
}

/** Present at or above the provider's share of the class; absent below it. */
export function markFor(minutes: number, length: number, percent: number): "present" | "absent" {
  if (length <= 0) return minutes > 0 ? "present" : "absent";
  return minutes * 100 >= length * percent ? "present" : "absent";
}
