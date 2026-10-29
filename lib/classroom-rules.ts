/**
 * Which sessions the LMS classroom holds, and where a session is joined from
 * (job sheet D41). Kept apart from lib/classroom.ts, which reaches the
 * database and the media server, because the notification sweep needs the
 * same rule and lib/classroom.ts itself raises notifications.
 *
 * This module imports nothing.
 */

/**
 * The ways a live class can be held (Roland, 29 October 2026). Each provider
 * chooses one as its usual way, and a single session can be held another way.
 * Google Meet and Teams are held at a pasted link until the LMS connects to
 * them; naming them now lets the provider's choice stand when it does.
 */
export const LIVE_CLASS_METHODS = ["lms_classroom", "google_meet", "microsoft_teams", "meeting_link"] as const;
export type LiveClassMethod = (typeof LIVE_CLASS_METHODS)[number];

export function isLiveClassMethod(value: unknown): value is LiveClassMethod {
  return typeof value === "string" && (LIVE_CLASS_METHODS as readonly string[]).includes(value);
}

/** The way this session is held: its own, or the provider's usual way. */
export function sessionMethod(
  providerMethod: LiveClassMethod,
  row: { liveClassMethod?: LiveClassMethod | null },
): LiveClassMethod {
  return row.liveClassMethod ?? providerMethod;
}

/**
 * Held in the classroom: the session is online, held the LMS classroom way
 * (its own choice or the provider's), and carries no outside meeting link.
 * Nothing has to be marked by hand, so an imported roll-out schedule is ready
 * as it stands; an outside link on a session is the contingency for a class
 * the media server cannot carry.
 */
export function heldInClassroom(
  providerMethod: LiveClassMethod,
  row: { deliveryMode: string; meetingUrl: string | null; liveClassMethod?: LiveClassMethod | null },
): boolean {
  return sessionMethod(providerMethod, row) === "lms_classroom" && row.deliveryMode !== "in_person" && !row.meetingUrl;
}

/**
 * Where a session is joined from, for every screen that offers to join one:
 * its outside link if it has one, the classroom if it is held there, nowhere
 * for a session in a venue.
 */
export function joinHref(
  providerMethod: LiveClassMethod,
  row: { id: string; deliveryMode: string; meetingUrl: string | null; liveClassMethod?: LiveClassMethod | null },
): { href: string; external: boolean } | null {
  if (row.meetingUrl && row.deliveryMode !== "in_person") return { href: row.meetingUrl, external: true };
  if (heldInClassroom(providerMethod, row)) return { href: `/classroom/${row.id}`, external: false };
  return null;
}

/** A class in the classroom, as an interval of instants (milliseconds). */
export type ClassSlot = { start: number; end: number };

/**
 * The most classes running at once in `slot`, counting the class being
 * booked there as one of them. Overlapping the slot is not enough: two
 * classes that each overlap it but not each other are never on at the same
 * time, so this sweeps the starts and ends rather than counting overlaps.
 */
export function peakClassesAt(slot: ClassSlot, others: ClassSlot[]): number {
  const events: [number, number][] = [];
  for (const one of [slot, ...others]) {
    const start = Math.max(one.start, slot.start);
    const end = Math.min(one.end, slot.end);
    if (start >= end) continue;
    events.push([start, 1], [end, -1]);
  }
  // An end and a start at the same moment do not overlap: ends first.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  let peak = 0;
  for (const [, change] of events) {
    running += change;
    peak = Math.max(peak, running);
  }
  return peak;
}
