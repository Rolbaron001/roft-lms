/**
 * Which sessions the LMS classroom holds, and where a session is joined from
 * (job sheet D41). Kept apart from lib/classroom.ts, which reaches the
 * database and the media server, because the notification sweep needs the
 * same rule and lib/classroom.ts itself raises notifications.
 *
 * This module imports nothing.
 */

/**
 * Held in the classroom: the provider has switched it on, and the session is
 * online without an outside meeting link. Nothing has to be marked by hand,
 * so an imported roll-out schedule is ready as it stands; an outside link on a
 * session is the contingency for a class the media server cannot carry.
 */
export function heldInClassroom(
  classroomEnabled: boolean,
  row: { deliveryMode: string; meetingUrl: string | null },
): boolean {
  return classroomEnabled && row.deliveryMode !== "in_person" && !row.meetingUrl;
}

/**
 * Where a session is joined from, for every screen that offers to join one:
 * its outside link if it has one, the classroom if it is held there, nowhere
 * for a session in a venue.
 */
export function joinHref(
  classroomEnabled: boolean,
  row: { id: string; deliveryMode: string; meetingUrl: string | null },
): { href: string; external: boolean } | null {
  if (row.meetingUrl && row.deliveryMode !== "in_person") return { href: row.meetingUrl, external: true };
  if (heldInClassroom(classroomEnabled, row)) return { href: `/classroom/${row.id}`, external: false };
  return null;
}
