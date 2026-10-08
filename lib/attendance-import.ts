import { readGrid } from "./roster-import";

/**
 * Reading a meeting's attendance export into a session's register (job sheet
 * D20). Curiosa's cohort folder holds one export per lecture, typed into the
 * register by hand afterwards. Two layouts were in it on 8 October 2026: the
 * Google Meet attendance add-on's CSV ("SNo, Participant Name, Attendance
 * Started at, …, Attended Duration, Meeting code") and Meet's own spreadsheet
 * ("Full Name, First Seen, Time in Call"). Meet's report can also carry
 * "First name, Last name, Email, Duration". Columns are found by their
 * headings, so any of these is read.
 *
 * Nothing is saved from here: the register is filled in for a person to
 * check and save.
 */

export type Attendee = { name: string; email: string | null; duration: string | null };

const norm = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z@.\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The people in an attendance export, in the order listed. */
export function readAttendanceExport(filename: string, bytes: Uint8Array): Attendee[] {
  const grid = readGrid(filename, bytes);
  const headerAt = grid.findIndex((row) => row.some((cell) => /^(participant name|full name|name|first name|display name)$/i.test(cell.trim())));
  if (headerAt < 0) return [];
  const header = grid[headerAt].map((cell) => norm(cell));
  const col = (...names: string[]) => header.findIndex((cell) => names.includes(cell));
  const full = col("participant name", "full name", "name", "display name");
  const first = col("first name");
  const last = col("last name", "surname");
  const email = col("email", "email address", "participant email");
  const duration = col("attended duration", "time in call", "duration", "attendance duration");

  const people: Attendee[] = [];
  for (const row of grid.slice(headerAt + 1)) {
    const name = full >= 0 ? row[full]?.trim() : [row[first], row[last]].filter(Boolean).join(" ").trim();
    if (!name) continue;
    people.push({
      name,
      email: email >= 0 && row[email]?.includes("@") ? row[email].trim().toLowerCase() : null,
      duration: duration >= 0 && row[duration]?.trim() ? row[duration].trim() : null,
    });
  }
  return people;
}

/**
 * Matches attendees to the cohort's learners: by email where the export has
 * one, otherwise by name, where every part of the learner's first and last
 * name appears in the participant's name, in any order and any case ("BONGI
 * MBOKANE", "Mbokane, Bongi"). A participant is matched to one learner only.
 */
export function matchAttendance(
  attendees: Attendee[],
  learners: { userId: string; firstName: string; lastName: string; email: string | null }[],
): { present: { userId: string; duration: string | null }[]; unknown: string[] } {
  const present: { userId: string; duration: string | null }[] = [];
  const unknown: string[] = [];
  const taken = new Set<string>();

  for (const person of attendees) {
    const words = new Set(norm(person.name).replace(/,/g, " ").split(" ").filter(Boolean));
    const match =
      (person.email ? learners.find((learner) => learner.email?.toLowerCase() === person.email) : undefined) ??
      learners.find((learner) => {
        const parts = norm(`${learner.firstName} ${learner.lastName}`).split(" ").filter(Boolean);
        return parts.length > 0 && parts.every((part) => words.has(part));
      });
    if (match && !taken.has(match.userId)) {
      taken.add(match.userId);
      present.push({ userId: match.userId, duration: person.duration });
    } else if (!match) {
      unknown.push(person.name);
    }
  }
  return { present, unknown };
}
