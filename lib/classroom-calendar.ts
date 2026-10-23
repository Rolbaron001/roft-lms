/**
 * A class as a calendar invitation (job sheet D41). Learners at Curiosa are
 * used to a class arriving in their calendar, as Google Meet's invitations do,
 * so each class's first message carries one.
 *
 * Written to RFC 5545 by hand rather than with a library: it is a dozen lines
 * of text, and every calendar a learner might use reads it. The identifier is
 * the session's, so a cancellation finds the entry it cancels instead of adding
 * a second one.
 *
 * This module imports nothing.
 */

export type ClassInvitation = {
  sessionId: string;
  /** The host the identifier is made unique under, e.g. the site's own. */
  domain: string;
  method: "REQUEST" | "CANCEL";
  start: Date;
  end: Date;
  summary: string;
  description: string;
  /** Where the class is joined: the LMS classroom page. */
  url: string;
  organiser: { name: string; email: string };
  attendee: { name: string; email: string };
};

/** 20261023T163000Z */
function stamp(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Commas, semicolons, backslashes and line breaks escaped, as the format requires. */
function text(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** A parameter value, quoted, with the quotes it may not contain removed. */
function quoted(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

/**
 * Lines longer than 75 octets folded onto continuation lines beginning with a
 * space. Counted in UTF-8 bytes, because a name with an accent is longer in
 * bytes than in letters and Outlook refuses a line that is too long.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const character of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (encoder.encode(current + character).length > limit) {
      parts.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function classInvitation(invite: ClassInvitation, now: Date = new Date()): string {
  const cancelled = invite.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ROFT//Learning Management System//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${invite.method}`,
    "BEGIN:VEVENT",
    `UID:class-${invite.sessionId}@${invite.domain}`,
    // A cancellation outranks the invitation it cancels.
    `SEQUENCE:${cancelled ? 1 : 0}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(invite.start)}`,
    `DTEND:${stamp(invite.end)}`,
    `SUMMARY:${text(invite.summary)}`,
    `DESCRIPTION:${text(`${invite.description}\n\n${invite.url}`)}`,
    `URL:${invite.url}`,
    `LOCATION:${text(invite.url)}`,
    `ORGANIZER;CN=${quoted(invite.organiser.name)}:mailto:${invite.organiser.email}`,
    `ATTENDEE;CN=${quoted(invite.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${invite.attendee.email}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
