import { reach } from "../drive/base";
import { heldSpan, serviceMessage, type MeetingAttendee, type MeetingProvider } from "./base";

/**
 * Microsoft Teams, through Microsoft Graph (v1.0).
 *
 * Checked against Microsoft's own reference on 29 October 2026, not recalled:
 * POST /me/onlineMeetings with `startDateTime`, `endDateTime` and `subject`
 * answers with the meeting's `id` and `joinWebUrl` (permission
 * OnlineMeetings.ReadWrite); GET /me/onlineMeetings/{id}/attendanceReports
 * lists a report for each time the meeting was held, and each report's
 * attendanceRecords carry the person's `emailAddress`, `identity.displayName`
 * and `attendanceIntervals` of `joinDateTime` and `leaveDateTime` (permission
 * OnlineMeetingArtifact.Read.All). Microsoft keeps attendance reports for a
 * year.
 *
 * Work or school accounts only: Microsoft does not offer attendance reports to
 * personal accounts, so the sign-in is limited to organisations.
 */

const AUTH = "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize";
const TOKEN = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

const SCOPE = "offline_access User.Read OnlineMeetings.ReadWrite OnlineMeetingArtifact.Read.All";

function clientId(): string {
  return process.env.MICROSOFT_TEAMS_CLIENT_ID?.trim() ?? "";
}

function clientSecret(): string {
  return process.env.MICROSOFT_TEAMS_CLIENT_SECRET?.trim() ?? "";
}

function explain(status: number, body: unknown): string {
  const message = serviceMessage(body, clientSecret());
  if (status === 401) return "Microsoft no longer accepts the connection. Connect Microsoft Teams again in Settings → Live classes.";
  if (status === 403) {
    return `Microsoft refused the request. The connected account may not be allowed to create Teams meetings, or the administrator has not approved the platform's access. ${message}`;
  }
  return message || `Microsoft returned ${status}.`;
}

async function call(url: string, accessToken: string, init?: RequestInit): Promise<unknown> {
  const response = await reach(url, { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${accessToken}` } }, "Microsoft");
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(explain(response.status, body));
  return body;
}

/** Every item across a collection's pages. */
async function all<T>(url: string, accessToken: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const body = (await call(next, accessToken)) as { value?: T[]; "@odata.nextLink"?: string };
    items.push(...(body?.value ?? []));
    next = body?.["@odata.nextLink"];
  }
  return items;
}

type AttendanceRecord = {
  emailAddress?: string | null;
  identity?: { id?: string | null; displayName?: string | null };
  attendanceIntervals?: { joinDateTime?: string; leaveDateTime?: string | null }[];
};

async function token(body: URLSearchParams) {
  const response = await reach(TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, "Microsoft");
  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw new Error(explain(response.status, parsed));
  return parsed as { refresh_token?: string; access_token?: string; expires_in?: number };
}

export const microsoftTeamsProvider: MeetingProvider = {
  name: "microsoft_teams",
  label: "Microsoft Teams",

  configured(): boolean {
    return Boolean(clientId() && clientSecret());
  },

  consentUrl({ state, redirectUri }): string {
    const query = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      response_mode: "query",
      state,
    });
    return `${AUTH}?${query.toString()}`;
  },

  async exchange({ code, redirectUri }) {
    const tokens = await token(
      new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri, grant_type: "authorization_code", scope: SCOPE }),
    );
    if (!tokens.refresh_token) throw new Error("Microsoft did not return a way to renew the connection.");

    let accountLabel: string | null = null;
    if (tokens.access_token) {
      try {
        const me = (await call(`${GRAPH}/me`, tokens.access_token)) as { mail?: string; userPrincipalName?: string };
        accountLabel = me.mail ?? me.userPrincipalName ?? null;
      } catch {
        // A label is a nicety; not reading it is no reason to refuse the connection.
      }
    }
    return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token ?? "", expiresIn: tokens.expires_in ?? 3600, accountLabel };
  },

  async refresh(refreshToken) {
    const tokens = await token(
      new URLSearchParams({ refresh_token: refreshToken, client_id: clientId(), client_secret: clientSecret(), grant_type: "refresh_token", scope: SCOPE }),
    );
    if (!tokens.access_token) throw new Error("Microsoft did not return an access token.");
    return { accessToken: tokens.access_token, expiresIn: tokens.expires_in ?? 3600 };
  },

  async createMeeting({ accessToken, title, start, end }) {
    const meeting = (await call(`${GRAPH}/me/onlineMeetings`, accessToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startDateTime: start.toISOString(), endDateTime: end.toISOString(), subject: title }),
    })) as { id?: string; joinWebUrl?: string };
    if (!meeting?.id || !meeting.joinWebUrl) throw new Error("Microsoft created the meeting but did not return its link.");
    return { externalId: meeting.id, joinUrl: meeting.joinWebUrl };
  },

  async attendance({ accessToken, externalId }) {
    const base = `${GRAPH}/me/onlineMeetings/${encodeURIComponent(externalId)}/attendanceReports`;
    const reports = await all<{ id: string; meetingStartDateTime?: string; meetingEndDateTime?: string }>(base, accessToken);

    const people = new Map<string, MeetingAttendee>();
    for (const report of reports) {
      const records = await all<AttendanceRecord>(`${base}/${encodeURIComponent(report.id)}/attendanceRecords`, accessToken);
      for (const record of records) {
        const name = (record.identity?.displayName ?? "").trim() || (record.emailAddress ?? "").trim();
        if (!name) continue;
        const email = record.emailAddress?.trim().toLowerCase() || null;
        const stays = (record.attendanceIntervals ?? [])
          .filter((interval) => interval.joinDateTime)
          .map((interval) => ({ joinedAt: new Date(interval.joinDateTime!), leftAt: interval.leaveDateTime ? new Date(interval.leaveDateTime) : null }));
        const key = email ?? record.identity?.id ?? `name:${name.toLowerCase()}`;
        const known = people.get(key);
        if (known) known.stays.push(...stays);
        else people.set(key, { name, email, stays });
      }
    }

    const attendees = [...people.values()];
    const starts = reports.map((report) => report.meetingStartDateTime).filter((time): time is string => Boolean(time)).map((time) => Date.parse(time));
    const ends = reports.map((report) => report.meetingEndDateTime).filter((time): time is string => Boolean(time)).map((time) => Date.parse(time));
    const held =
      starts.length > 0 && ends.length === reports.length
        ? { startedAt: new Date(Math.min(...starts)), endedAt: new Date(Math.max(...ends)) }
        : heldSpan(attendees, new Date());
    return { held, attendees };
  },
};
