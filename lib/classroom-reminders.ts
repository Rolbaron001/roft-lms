import { and, eq, exists, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { withPlatformScope, withTenant, type TenantDatabase } from "@/db/client";
import { cohortMembers, cohortSessions, cohorts, mailMessages, notifications, organisations, users } from "@/db/schema";
import { raise, sessionAnnouncement, type NotificationKind } from "./notifications";
import { heldInClassroom } from "./classroom-rules";
import { classInvitation } from "./classroom-calendar";
import { mailDomainFor } from "./mail";
import { dateInZone, zonedTimeToUtc } from "./timezone";

/**
 * Telling people about their classes in the LMS classroom (job sheet D41).
 *
 * Three messages for each class: a week ahead, which carries the calendar
 * invitation; the day before; and fifteen minutes before, with the link to
 * come in. Each goes to the notification list, to the person's own email, and,
 * as Roland asked, to their mailbox in the LMS.
 *
 * Run every five minutes (POST /api/classroom/tick) and with the daily sweep.
 * Safe to run as often as that: each message carries a key, and a message
 * already sent is never sent again. A class moved to another time is a new
 * class to announce, because the key carries the time.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Stage = { kind: NotificationKind; key: string; from: number; to: number };

/**
 * When each message goes, in minutes before the start. The week-ahead message
 * keeps the kind and key the sweep has always used for an announcement, so a
 * cancellation still finds everybody who was told.
 */
const STAGES: Stage[] = [
  { kind: "session.announced", key: "session", from: 7 * DAY, to: DAY },
  { kind: "class.reminder", key: "class_day", from: DAY, to: 60 * MINUTE },
  { kind: "class.reminder", key: "class_soon", from: 15 * MINUTE, to: -30 * MINUTE },
];

export type ReminderResult = { announced: number; reminded: number };

/** One provider's classes, looked over and anybody due a message told. */
export async function classReminders(organisationId: string, now: Date = new Date()): Promise<ReminderResult> {
  const result: ReminderResult = { announced: 0, reminded: 0 };

  await withTenant(organisationId, async (tx) => {
    const [provider] = await tx
      .select({ method: organisations.liveClassMethod, timezone: organisations.timezone, slug: organisations.slug, name: organisations.displayName })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    if (!provider) return;

    const sessions = await tx
      .select({
        id: cohortSessions.id,
        cohortId: cohortSessions.cohortId,
        cohortName: cohorts.name,
        kind: cohortSessions.kind,
        title: cohortSessions.title,
        scheduledDate: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        endTime: cohortSessions.endTime,
        deliveryMode: cohortSessions.deliveryMode,
        meetingUrl: cohortSessions.meetingUrl,
        liveClassMethod: cohortSessions.liveClassMethod,
        venue: cohortSessions.venue,
        facilitatorId: cohortSessions.facilitatorId,
      })
      .from(cohortSessions)
      .innerJoin(cohorts, eq(cohorts.id, cohortSessions.cohortId))
      .where(
        and(
          eq(cohortSessions.status, "scheduled"),
          inArray(cohorts.status, ["planned", "running"]),
          gte(cohortSessions.scheduledDate, dateInZone(new Date(now.getTime() - DAY), provider.timezone)),
          lte(cohortSessions.scheduledDate, dateInZone(new Date(now.getTime() + 8 * DAY), provider.timezone)),
        ),
      );

    for (const row of sessions) {
      if (!heldInClassroom(provider.method, row)) continue;
      const startsAt = zonedTimeToUtc(row.scheduledDate, row.startTime, provider.timezone);
      const until = startsAt.getTime() - now.getTime();
      const stage = STAGES.find((one) => until <= one.from && until > one.to);
      if (!stage) continue;

      const members = await tx
        .select({ userId: cohortMembers.userId })
        .from(cohortMembers)
        .where(and(eq(cohortMembers.cohortId, row.cohortId), isNull(cohortMembers.leftAt)));
      const people = [...new Set([...members.map((member) => member.userId), ...(row.facilitatorId ? [row.facilitatorId] : [])])];
      const { subject, body } = classMessage(row, stage.key);

      for (const userId of people) {
        const dedupeKey = `${stage.key}:${row.id}:${row.scheduledDate}:${row.startTime ?? ""}:${userId}`;
        const [already] = await tx
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(notifications.dedupeKey, dedupeKey), eq(notifications.channel, "in_app")));
        if (already) continue;

        await raise(tx, {
          organisationId,
          userId,
          kind: stage.kind,
          subject,
          body,
          linkPath: `/classroom/${row.id}`,
          entityType: "cohort_session",
          entityId: row.id,
          dedupeKey,
          channels: ["in_app", "email"],
        });
        await fileInMailbox(tx, organisationId, userId, { from: `classroom@${mailDomainFor(provider.slug)}`, fromName: provider.name, subject, body: `${body}\n\n${process.env.AUTH_URL ?? ""}/classroom/${row.id}` });
        if (stage.key === "session") result.announced += 1;
        else result.reminded += 1;
      }
    }
  });

  return result;
}

/** What each message says. Times are the provider's clock, as on the timetable. */
export function classMessage(
  row: Parameters<typeof sessionAnnouncement>[0],
  stage: string,
): { subject: string; body: string } {
  const announced = sessionAnnouncement(row);
  const where = "It is held in the LMS classroom. Open the class from the link, or from your dashboard; it opens fifteen minutes before the start.";
  if (stage === "class_soon") {
    return { subject: `Starting soon: ${announced.subject}`, body: `${announced.body}\nThe class is about to start. Join it now.` };
  }
  if (stage === "class_day") {
    return { subject: `Tomorrow: ${announced.subject}`, body: `${announced.body}\n${where}` };
  }
  return { subject: announced.subject, body: `${announced.body}\n${where}\nThe calendar invitation with the email puts the class in your calendar.` };
}

/**
 * A copy in the person's mailbox in the LMS, for those who have one. Filed as
 * received mail, unread, from the provider's classroom address, which nobody
 * can reply to because it is not a person's mailbox.
 */
async function fileInMailbox(
  tx: TenantDatabase,
  organisationId: string,
  userId: string,
  message: { from: string; fromName: string; subject: string; body: string },
): Promise<void> {
  const [person] = await tx.select({ mailboxAddress: users.mailboxAddress }).from(users).where(eq(users.id, userId));
  if (!person?.mailboxAddress) return;
  await tx.insert(mailMessages).values({
    organisationId,
    mailboxUserId: userId,
    direction: "inbound",
    fromAddress: message.from,
    fromName: message.fromName,
    toAddresses: person.mailboxAddress,
    subject: message.subject,
    bodyText: message.body,
  });
}

/**
 * Every provider that holds classes in the classroom: as its usual way, or
 * for a session moved into it. For the scheduled run.
 */
export async function classRemindersAllTenants(now: Date = new Date()) {
  const tenants = await withPlatformScope("classroom reminders across providers holding classes in the classroom", (tx) =>
    tx
      .select({ id: organisations.id, name: organisations.displayName })
      .from(organisations)
      .where(
        and(
          eq(organisations.status, "active"),
          or(
            eq(organisations.liveClassMethod, "lms_classroom"),
            exists(
              tx
                .select({ id: cohortSessions.id })
                .from(cohortSessions)
                .where(and(eq(cohortSessions.organisationId, organisations.id), eq(cohortSessions.liveClassMethod, "lms_classroom"))),
            ),
          ),
        ),
      ),
  );
  const results: { tenant: string; result: ReminderResult }[] = [];
  for (const tenant of tenants) {
    results.push({ tenant: tenant.name, result: await classReminders(tenant.id, now) });
  }
  return results;
}

/** The address calendar invitations come from: the sending address itself. */
function organiserAddress(): string | null {
  const from = process.env.MAIL_FROM ?? "";
  const match = /<([^>]+)>/.exec(from);
  const address = (match ? match[1] : from).trim();
  return address.includes("@") ? address : null;
}

/**
 * The calendar invitation for a class's email, or null: the week-ahead
 * message carries the invitation, and a cancellation cancels it. Worked out
 * when the email is sent, so it carries the class as it stands then.
 */
export async function calendarFor(message: {
  organisationId: string;
  kind: string;
  entityType: string | null;
  entityId: string | null;
  email: string;
  firstName: string;
}): Promise<{ method: "REQUEST" | "CANCEL"; content: string } | null> {
  if (message.entityType !== "cohort_session" || !message.entityId) return null;
  const method = message.kind === "session.announced" ? "REQUEST" : message.kind === "session.cancelled" ? "CANCEL" : null;
  const organiser = organiserAddress();
  if (!method || !organiser) return null;

  const row = await withTenant(message.organisationId, async (tx) => {
    const [found] = await tx
      .select({
        id: cohortSessions.id,
        kind: cohortSessions.kind,
        title: cohortSessions.title,
        cohortName: cohorts.name,
        scheduledDate: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        endTime: cohortSessions.endTime,
        deliveryMode: cohortSessions.deliveryMode,
        meetingUrl: cohortSessions.meetingUrl,
        venue: cohortSessions.venue,
        liveClassMethod: cohortSessions.liveClassMethod,
        method: organisations.liveClassMethod,
        timezone: organisations.timezone,
        providerName: organisations.displayName,
      })
      .from(cohortSessions)
      .innerJoin(cohorts, eq(cohorts.id, cohortSessions.cohortId))
      .innerJoin(organisations, eq(organisations.id, cohortSessions.organisationId))
      .where(eq(cohortSessions.id, message.entityId!));
    return found ?? null;
  });
  if (!row || !row.startTime || !heldInClassroom(row.method, row)) return null;

  const start = zonedTimeToUtc(row.scheduledDate, row.startTime, row.timezone);
  const end = row.endTime ? zonedTimeToUtc(row.scheduledDate, row.endTime, row.timezone) : new Date(start.getTime() + 60 * MINUTE);
  const base = process.env.AUTH_URL ?? "";
  const { subject, body } = sessionAnnouncement(row);
  return {
    method,
    content: classInvitation({
      sessionId: row.id,
      domain: base.replace(/^https?:\/\//, "").replace(/[/:].*$/, "") || "lms.invalid",
      method,
      start,
      end,
      summary: subject,
      description: body,
      url: `${base}/classroom/${row.id}`,
      organiser: { name: row.providerName, email: organiser },
      attendee: { name: message.firstName, email: message.email },
    }),
  };
}
