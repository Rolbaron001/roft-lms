/**
 * Holding a class in the provider's own Google Meet or Microsoft Teams
 * (Roland, 29 October 2026; job sheet D41, "Connected").
 *
 * A provider connects its account once in Settings → Live classes. The LMS
 * then creates each class's meeting there and puts its link on the session, so
 * the announcement and reminders carry it; after the class it reads who joined
 * and left, and when, into the register for a person to check and save.
 *
 * A meeting service does five things: say where to send somebody to consent,
 * turn what comes back into tokens, renew them, create a meeting, and report
 * who attended one. Everything else (the register, the present percentage,
 * matching people to learners) is the code that already exists for an
 * attendance export and for the LMS classroom.
 *
 * As with the drives, the OAuth application belongs to whoever runs the
 * deployment, so its client id and secret are configuration. Without them the
 * service is absent rather than present and failing.
 *
 * This module imports nothing, so the shapes can be used from a form.
 */

export const MEETING_SERVICES = ["google_meet", "microsoft_teams"] as const;
export type MeetingService = (typeof MEETING_SERVICES)[number];

export function isMeetingService(value: unknown): value is MeetingService {
  return typeof value === "string" && (MEETING_SERVICES as readonly string[]).includes(value);
}

export type MeetingTokens = {
  refreshToken: string;
  accessToken: string;
  /** Seconds from now. */
  expiresIn: number;
  /** The account that consented, shown in Settings. */
  accountLabel: string | null;
};

export type CreatedMeeting = {
  /** The service's own id: a Meet space name, or a Teams online meeting id. */
  externalId: string;
  joinUrl: string;
};

/** One time somebody was in the meeting. */
export type MeetingStay = { joinedAt: Date; leftAt: Date | null };

/** One person in the meeting, with every time they were in it. */
export type MeetingAttendee = {
  name: string;
  /** Teams reports it; Meet does not. */
  email: string | null;
  stays: MeetingStay[];
};

export type MeetingAttendance = {
  /** When the meeting was first and last in use; null if it never was. */
  held: { startedAt: Date; endedAt: Date } | null;
  attendees: MeetingAttendee[];
};

export type MeetingProvider = {
  name: MeetingService;
  label: string;
  configured(): boolean;
  consentUrl(input: { state: string; redirectUri: string }): string;
  exchange(input: { code: string; redirectUri: string }): Promise<MeetingTokens>;
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  createMeeting(input: { accessToken: string; title: string; start: Date; end: Date }): Promise<CreatedMeeting>;
  attendance(input: { accessToken: string; externalId: string }): Promise<MeetingAttendance>;
};

/** The service's error text, with a secret removed before anything reads it. */
export function serviceMessage(body: unknown, secret: string): string {
  const raw =
    typeof body === "object" && body !== null
      ? String(
          (body as { error_description?: string }).error_description ??
            (body as { error?: { message?: string } }).error?.message ??
            JSON.stringify(body).slice(0, 300),
        )
      : String(body ?? "").slice(0, 300);
  return secret ? raw.split(secret).join("[secret removed]") : raw;
}

/** The earliest join and latest leave across everybody, as the meeting held. */
export function heldSpan(attendees: MeetingAttendee[], fallbackEnd: Date): { startedAt: Date; endedAt: Date } | null {
  const stays = attendees.flatMap((person) => person.stays);
  if (stays.length === 0) return null;
  const start = Math.min(...stays.map((stay) => stay.joinedAt.getTime()));
  const end = Math.max(...stays.map((stay) => (stay.leftAt ?? fallbackEnd).getTime()));
  return { startedAt: new Date(start), endedAt: new Date(end) };
}
