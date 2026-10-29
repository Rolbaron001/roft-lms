/**
 * The provider's connected Google Meet or Microsoft Teams account, and what
 * the LMS does with it (job sheet D41, "Connected"; Roland, 29 October 2026).
 *
 * The connection is the provider's, not a person's: the meetings belong to the
 * organisation's account, and every facilitator's classes are created in it.
 * Tokens are sealed and never leave this module; what reaches a screen is the
 * account's name and when it was connected.
 *
 * What it does:
 * - creates the meeting for an online session held the Meet or Teams way that
 *   has no link yet, when it is scheduled or moved to that way, and again in
 *   the daily run a week ahead for any still without one (a roll-out schedule
 *   of thirty lectures is not thirty calls in one sitting);
 * - reads the meeting's attendance into the register for a person to check
 *   and save, measured against the provider's present percentage, as the LMS
 *   classroom's register is.
 */
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import { cohortMembers, cohortSessions, cohorts, meetingConnections, organisations, users } from "@/db/schema";
import { recordAudit } from "../audit";
import { seal, sealingAvailable, unseal } from "../secret-box";
import { assertSessionCan, type AuthenticatedSession } from "../session";
import { sessionMethod, type LiveClassMethod } from "../classroom-rules";
import { classLength, markFor, minutesIn } from "../classroom-attendance";
import { matchAttendance } from "../attendance-import";
import { dateInZone, zonedTimeToUtc } from "../timezone";
import { googleMeetProvider } from "./google-meet";
import { microsoftTeamsProvider } from "./microsoft-teams";
import { MEETING_SERVICES, isMeetingService, type MeetingProvider, type MeetingService, type MeetingTokens } from "./base";

export * from "./base";

const PROVIDERS: Record<MeetingService, MeetingProvider> = {
  google_meet: googleMeetProvider,
  microsoft_teams: microsoftTeamsProvider,
};

export class MeetingError extends Error {}

export function meetingProvider(name: string): MeetingProvider | null {
  return isMeetingService(name) ? PROVIDERS[name] : null;
}

/**
 * The service an online session's meeting is created in, or null: held the
 * Meet or Teams way (its own or the provider's), online, and with no link.
 */
export function meetingServiceFor(
  providerMethod: LiveClassMethod,
  row: { deliveryMode: string; meetingUrl: string | null; liveClassMethod?: LiveClassMethod | null },
): MeetingService | null {
  if (row.deliveryMode === "in_person" || row.meetingUrl) return null;
  const method = sessionMethod(providerMethod, row);
  return isMeetingService(method) ? method : null;
}

// ---------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------

export type MeetingConnectionView = {
  service: MeetingService;
  label: string;
  /** Whether this deployment has the service set up at all. */
  configured: boolean;
  accountLabel: string | null;
  connectedAt: Date | null;
};

/** Both services, connected or not, for Settings. No tokens. */
export async function meetingConnectionsFor(session: AuthenticatedSession): Promise<MeetingConnectionView[]> {
  assertSessionCan(session, "tenant:manage_settings");
  const rows = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ service: meetingConnections.service, accountLabel: meetingConnections.accountLabel, connectedAt: meetingConnections.connectedAt })
      .from(meetingConnections),
  );
  return MEETING_SERVICES.map((service) => {
    const row = rows.find((one) => one.service === service);
    return {
      service,
      label: PROVIDERS[service].label,
      configured: PROVIDERS[service].configured(),
      accountLabel: row?.accountLabel ?? null,
      connectedAt: row?.connectedAt ?? null,
    };
  });
}

/** Records a consent that has just come back, replacing any earlier one. */
export async function recordMeetingConnection(session: AuthenticatedSession, service: MeetingService, tokens: MeetingTokens): Promise<void> {
  assertSessionCan(session, "tenant:manage_settings");
  if (!sealingAvailable()) {
    throw new MeetingError("The account cannot be connected: this deployment has no sealing key set. Contact whoever maintains it.");
  }
  await withTenant(session.organisationId, async (tx) => {
    await tx.delete(meetingConnections).where(eq(meetingConnections.service, service));
    await tx.insert(meetingConnections).values({
      organisationId: session.organisationId,
      service,
      accountLabel: tokens.accountLabel,
      refreshTokenSealed: seal(tokens.refreshToken),
      accessTokenSealed: tokens.accessToken ? seal(tokens.accessToken) : null,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      connectedById: session.userId,
    });
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "meeting_account.connected",
      entityType: "organisation",
      entityId: session.organisationId,
      // The account, never a token.
      after: { service, account: tokens.accountLabel },
    });
  });
}

/** Forgets the connection. Meetings already created keep their links. */
export async function disconnectMeetingService(session: AuthenticatedSession, service: MeetingService): Promise<void> {
  assertSessionCan(session, "tenant:manage_settings");
  await withTenant(session.organisationId, async (tx) => {
    await tx.delete(meetingConnections).where(eq(meetingConnections.service, service));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "meeting_account.disconnected",
      entityType: "organisation",
      entityId: session.organisationId,
      after: { service },
    });
  });
}

/** The services this provider has connected. */
async function connectedWithin(tx: TenantDatabase): Promise<Set<MeetingService>> {
  const rows = await tx.select({ service: meetingConnections.service }).from(meetingConnections);
  return new Set(rows.map((row) => row.service).filter(isMeetingService));
}

/**
 * A usable access token for the provider's account, renewed a minute early
 * when the stored one has expired. Never returned beyond this module.
 */
async function accessToken(organisationId: string, service: MeetingService): Promise<string> {
  const provider = PROVIDERS[service];
  const [row] = await withTenant(organisationId, (tx) =>
    tx
      .select({
        id: meetingConnections.id,
        refreshTokenSealed: meetingConnections.refreshTokenSealed,
        accessTokenSealed: meetingConnections.accessTokenSealed,
        accessTokenExpiresAt: meetingConnections.accessTokenExpiresAt,
      })
      .from(meetingConnections)
      .where(eq(meetingConnections.service, service)),
  );
  if (!row) throw new MeetingError(`${provider.label} is not connected. Connect it in Settings → Live classes.`);

  const stillGood = row.accessTokenSealed && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - 60_000 > Date.now();
  const stored = stillGood ? unseal(row.accessTokenSealed) : null;
  if (stored) {
    await withTenant(organisationId, (tx) => tx.update(meetingConnections).set({ lastUsedAt: new Date() }).where(eq(meetingConnections.id, row.id)));
    return stored;
  }

  const refreshToken = unseal(row.refreshTokenSealed);
  if (!refreshToken) throw new MeetingError(`The stored ${provider.label} connection cannot be read. Connect it again in Settings → Live classes.`);
  const renewed = await provider.refresh(refreshToken);
  await withTenant(organisationId, (tx) =>
    tx
      .update(meetingConnections)
      .set({
        accessTokenSealed: seal(renewed.accessToken),
        accessTokenExpiresAt: new Date(Date.now() + renewed.expiresIn * 1000),
        lastUsedAt: new Date(),
      })
      .where(eq(meetingConnections.id, row.id)),
  );
  return renewed.accessToken;
}

// ---------------------------------------------------------------------------
// Creating the meeting
// ---------------------------------------------------------------------------

export type MeetingOutcome =
  | { kind: "not_needed" }
  | { kind: "not_connected"; service: MeetingService }
  | { kind: "created"; service: MeetingService }
  | { kind: "failed"; service: MeetingService; message: string };

const TWO_HOURS = 2 * 60 * 60_000;

/**
 * Creates the meeting for one session if it needs one and the provider has
 * connected the service. Never throws for the service's own refusal: the
 * session stands either way, and the outcome says what happened.
 */
export async function createMeetingFor(organisationId: string, sessionId: string): Promise<MeetingOutcome> {
  const found = await withTenant(organisationId, async (tx) => {
    const [provider] = await tx
      .select({ method: organisations.liveClassMethod, timezone: organisations.timezone })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    const [row] = await tx
      .select({
        status: cohortSessions.status,
        kind: cohortSessions.kind,
        title: cohortSessions.title,
        cohortName: cohorts.name,
        scheduledDate: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        endTime: cohortSessions.endTime,
        deliveryMode: cohortSessions.deliveryMode,
        meetingUrl: cohortSessions.meetingUrl,
        liveClassMethod: cohortSessions.liveClassMethod,
      })
      .from(cohortSessions)
      .innerJoin(cohorts, eq(cohorts.id, cohortSessions.cohortId))
      .where(eq(cohortSessions.id, sessionId));
    if (!provider || !row || row.status !== "scheduled") return null;
    const service = meetingServiceFor(provider.method, row);
    if (!service) return null;
    return { row, service, timezone: provider.timezone, connected: (await connectedWithin(tx)).has(service) };
  });
  if (!found) return { kind: "not_needed" };
  const { row, service, timezone, connected } = found;
  if (!connected) return { kind: "not_connected", service };

  try {
    const start = zonedTimeToUtc(row.scheduledDate, row.startTime, timezone);
    const end = row.endTime ? zonedTimeToUtc(row.scheduledDate, row.endTime, timezone) : new Date(start.getTime() + TWO_HOURS);
    const title = [row.cohortName, row.title || row.kind.replace(/_/g, " ")].join(": ");
    const meeting = await PROVIDERS[service].createMeeting({ accessToken: await accessToken(organisationId, service), title, start, end });

    await withTenant(organisationId, async (tx) => {
      // Only where nobody pasted a link in the meantime.
      const updated = await tx
        .update(cohortSessions)
        .set({ meetingUrl: meeting.joinUrl, meetingService: service, meetingExternalId: meeting.externalId, updatedAt: new Date() })
        .where(and(eq(cohortSessions.id, sessionId), isNull(cohortSessions.meetingUrl)))
        .returning({ id: cohortSessions.id });
      if (updated.length > 0) {
        await recordAudit(tx, {
          organisationId,
          action: "session.meeting_created",
          entityType: "cohort_session",
          entityId: sessionId,
          after: { service, meetingUrl: meeting.joinUrl },
        });
      }
    });
    return { kind: "created", service };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The meeting could not be created.";
    console.error("meeting not created", { service, sessionId, message });
    return { kind: "failed", service, message };
  }
}

/**
 * Meetings for every session in the coming week still without one, for the
 * daily run: before the week-ahead announcement, so it carries the link.
 */
export async function ensureMeetings(organisationId: string, now: Date = new Date()): Promise<{ created: number; failed: number }> {
  const due = await withTenant(organisationId, async (tx) => {
    const connected = await connectedWithin(tx);
    if (connected.size === 0) return [];
    const [provider] = await tx
      .select({ method: organisations.liveClassMethod, timezone: organisations.timezone })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    if (!provider) return [];
    const rows = await tx
      .select({
        id: cohortSessions.id,
        deliveryMode: cohortSessions.deliveryMode,
        meetingUrl: cohortSessions.meetingUrl,
        liveClassMethod: cohortSessions.liveClassMethod,
      })
      .from(cohortSessions)
      .innerJoin(cohorts, eq(cohorts.id, cohortSessions.cohortId))
      .where(
        and(
          eq(cohortSessions.status, "scheduled"),
          isNull(cohortSessions.meetingUrl),
          inArray(cohorts.status, ["planned", "running"]),
          gte(cohortSessions.scheduledDate, dateInZone(now, provider.timezone)),
          lte(cohortSessions.scheduledDate, dateInZone(new Date(now.getTime() + 8 * 86_400_000), provider.timezone)),
        ),
      );
    return rows.filter((row) => {
      const service = meetingServiceFor(provider.method, row);
      return service !== null && connected.has(service);
    });
  });

  const result = { created: 0, failed: 0 };
  for (const row of due) {
    const outcome = await createMeetingFor(organisationId, row.id);
    if (outcome.kind === "created") result.created += 1;
    if (outcome.kind === "failed") result.failed += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reading attendance back
// ---------------------------------------------------------------------------

/** The service a session's meeting was created in, if the LMS created it. */
export async function meetingCreatedIn(session: AuthenticatedSession, sessionId: string): Promise<MeetingService | null> {
  const [row] = await withTenant(session.organisationId, (tx) =>
    tx.select({ service: cohortSessions.meetingService }).from(cohortSessions).where(eq(cohortSessions.id, sessionId)),
  );
  return isMeetingService(row?.service) ? row.service : null;
}

/**
 * A register proposed from the meeting the LMS created: each learner found in
 * it present if in the call for the provider's share of the class, otherwise
 * absent, with their minutes as the note; everyone else absent; names that
 * match no learner listed. Nothing is saved: the register page shows it for a
 * person to check and save, as with an attendance export.
 */
export async function proposeAttendanceFromMeeting(
  session: AuthenticatedSession,
  sessionId: string,
): Promise<{ marks: { userId: string; status: "present" | "absent"; note: string }[]; unknown: string[]; read: number }> {
  assertSessionCan(session, "attendance:record");
  const context = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        cohortId: cohortSessions.cohortId,
        startTime: cohortSessions.startTime,
        endTime: cohortSessions.endTime,
        service: cohortSessions.meetingService,
        externalId: cohortSessions.meetingExternalId,
      })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, sessionId));
    if (!row) throw new MeetingError("Session not found.");
    const [provider] = await tx
      .select({ presentPercent: organisations.classroomPresentPercent })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));
    const learners = await tx
      .select({ userId: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(and(eq(cohortMembers.cohortId, row.cohortId), isNull(cohortMembers.leftAt)));
    return { row, learners, presentPercent: provider?.presentPercent ?? 75 };
  });

  const { row, learners, presentPercent } = context;
  if (!isMeetingService(row.service) || !row.externalId) {
    throw new MeetingError("This session's meeting was not created by the LMS. Upload the meeting's attendance export instead.");
  }
  const attendance = await PROVIDERS[row.service].attendance({ accessToken: await accessToken(session.organisationId, row.service), externalId: row.externalId });
  if (!attendance.held || attendance.attendees.length === 0) {
    throw new MeetingError(`${PROVIDERS[row.service].label} has no attendance for this meeting yet. It is available once the meeting has ended.`);
  }

  const { startedAt, endedAt } = attendance.held;
  const length = classLength(row, { startedAt, endedAt });
  const people = attendance.attendees.map((person) => {
    const minutes = minutesIn(person.stays, startedAt, endedAt);
    return { name: person.name, email: person.email, duration: `${minutes} min`, minutes };
  });
  const { present, unknown } = matchAttendance(people, learners);

  return {
    marks: learners.map((learner) => {
      const found = present.find((one) => one.userId === learner.userId);
      if (!found) return { userId: learner.userId, status: "absent" as const, note: "" };
      const status = markFor(found.attendee.minutes, length, presentPercent);
      return {
        userId: learner.userId,
        status,
        note: status === "present" ? `In the call ${found.attendee.minutes} min` : `In the call ${found.attendee.minutes} of ${length} min, below ${presentPercent}%`,
      };
    }),
    unknown,
    read: people.length,
  };
}
