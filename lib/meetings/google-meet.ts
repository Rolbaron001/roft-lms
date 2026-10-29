import { reach } from "../drive/base";
import { heldSpan, serviceMessage, type MeetingAttendee, type MeetingProvider, type MeetingStay } from "./base";

/**
 * Google Meet, through the Meet REST API (v2).
 *
 * Checked against Google's own reference on 29 October 2026, not recalled:
 * a meeting space is created with POST /v2/spaces and answers with its `name`
 * ("spaces/…") and `meetingUri`; a space's conferences are listed with
 * `filter=space.name = "…"`; each conference lists its participants, and each
 * participant its sessions with `startTime` and `endTime`.
 *
 * `meetings.space.created` is the one Meet scope asked for. It creates spaces
 * and reads the conferences of spaces this application created, and nothing
 * else in the account. `openid email` only names the account in Settings.
 *
 * Meet does not give a participant's email address, only their name, so
 * people are matched to learners by name, and anyone unmatched is listed.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const MEET = "https://meet.googleapis.com/v2";

const SCOPE = "openid email https://www.googleapis.com/auth/meetings.space.created";

function clientId(): string {
  return process.env.GOOGLE_MEET_CLIENT_ID?.trim() ?? "";
}

function clientSecret(): string {
  return process.env.GOOGLE_MEET_CLIENT_SECRET?.trim() ?? "";
}

function explain(status: number, body: unknown): string {
  const message = serviceMessage(body, clientSecret());
  if (status === 401) return "Google no longer accepts the connection. Connect Google Meet again in Settings → Live classes.";
  if (status === 403) return `Google refused the request. The connected account may not be allowed to create meetings. ${message}`;
  return message || `Google returned ${status}.`;
}

async function call(url: string, accessToken: string, init?: RequestInit): Promise<unknown> {
  const response = await reach(url, { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${accessToken}` } }, "Google");
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(explain(response.status, body));
  return body;
}

/** Every item across a listing's pages. */
async function all<T>(url: string, key: string, accessToken: string): Promise<T[]> {
  const items: T[] = [];
  let pageToken = "";
  do {
    const page = new URL(url);
    page.searchParams.set("pageSize", "100");
    if (pageToken) page.searchParams.set("pageToken", pageToken);
    const body = (await call(page.toString(), accessToken)) as Record<string, unknown> & { nextPageToken?: string };
    items.push(...(((body?.[key] as T[] | undefined) ?? [])));
    pageToken = body?.nextPageToken ?? "";
  } while (pageToken);
  return items;
}

/** The email in an ID token, which is only read here, never trusted for anything. */
function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

type Participant = {
  name: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};

export const googleMeetProvider: MeetingProvider = {
  name: "google_meet",
  label: "Google Meet",

  configured(): boolean {
    return Boolean(clientId() && clientSecret());
  },

  consentUrl({ state, redirectUri }): string {
    const query = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      // A refresh token every time, so a reconnected account can be renewed.
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTH}?${query.toString()}`;
  },

  async exchange({ code, redirectUri }) {
    const response = await reach(
      TOKEN,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri, grant_type: "authorization_code" }),
      },
      "Google",
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(explain(response.status, body));
    const tokens = body as { refresh_token?: string; access_token?: string; expires_in?: number; id_token?: string };
    if (!tokens.refresh_token) {
      throw new Error("Google did not return a way to renew the connection. Remove the platform's access in the Google account under Third-party apps, then connect again.");
    }
    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? "",
      expiresIn: tokens.expires_in ?? 3600,
      accountLabel: emailFromIdToken(tokens.id_token),
    };
  },

  async refresh(refreshToken) {
    const response = await reach(
      TOKEN,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId(), client_secret: clientSecret(), grant_type: "refresh_token" }),
      },
      "Google",
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(explain(response.status, body));
    const tokens = body as { access_token?: string; expires_in?: number };
    if (!tokens.access_token) throw new Error("Google did not return an access token.");
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in ?? 3600 };
  },

  async createMeeting({ accessToken }) {
    // A Meet space has no title or time of its own; the session carries both.
    // Who may join without asking is left to the account's own settings.
    const space = (await call(`${MEET}/spaces`, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })) as { name?: string; meetingUri?: string };
    if (!space?.name || !space.meetingUri) throw new Error("Google created the meeting but did not return its link.");
    return { externalId: space.name, joinUrl: space.meetingUri };
  },

  async attendance({ accessToken, externalId }) {
    const records = await all<{ name: string; startTime?: string; endTime?: string }>(
      `${MEET}/conferenceRecords?filter=${encodeURIComponent(`space.name = "${externalId}"`)}`,
      "conferenceRecords",
      accessToken,
    );

    // One person, however many times they joined; keyed by their Google
    // account where they signed in, otherwise by the name they gave.
    const people = new Map<string, MeetingAttendee>();
    for (const record of records) {
      const participants = await all<Participant>(`${MEET}/${record.name}/participants`, "participants", accessToken);
      for (const participant of participants) {
        const name = (participant.signedinUser?.displayName ?? participant.anonymousUser?.displayName ?? participant.phoneUser?.displayName ?? "").trim();
        if (!name) continue;
        const sessions = await all<{ startTime?: string; endTime?: string }>(`${MEET}/${participant.name}/participantSessions`, "participantSessions", accessToken);
        const stays: MeetingStay[] = sessions
          .filter((one) => one.startTime)
          .map((one) => ({ joinedAt: new Date(one.startTime!), leftAt: one.endTime ? new Date(one.endTime) : null }));
        const key = participant.signedinUser?.user ?? `name:${name.toLowerCase()}`;
        const known = people.get(key);
        if (known) known.stays.push(...stays);
        else people.set(key, { name, email: null, stays });
      }
    }

    const attendees = [...people.values()];
    const starts = records.map((record) => record.startTime).filter((time): time is string => Boolean(time)).map((time) => Date.parse(time));
    const ends = records.map((record) => record.endTime).filter((time): time is string => Boolean(time)).map((time) => Date.parse(time));
    const held =
      starts.length > 0 && ends.length === records.length
        ? { startedAt: new Date(Math.min(...starts)), endedAt: new Date(Math.max(...ends)) }
        : heldSpan(attendees, new Date());
    return { held, attendees };
  },
};
