import { and, asc, count, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { withPlatformScope, withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentSubmissions,
  courses,
  enrolments,
  moderationQueue,
  notifications,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import type { AuthenticatedSession } from "./session";

/**
 * Notifications.
 *
 * Written down first, delivered separately. Two consequences worth stating:
 *
 *   - A message is never lost because sending failed, and the absence of a
 *     mail server is not a reason to skip recording that somebody should have
 *     been told. Whatever queues now goes out when SMTP is configured.
 *   - Every notification carries a dedupe key. A nightly job scanning for
 *     overdue training would otherwise send the same reminder every night,
 *     which is how people learn to ignore notifications entirely.
 *
 * In-app is a first-class channel, not a consolation. An assessor signing in
 * to "three submissions waiting" has been told, and told at the moment they
 * can act.
 */

export type NotificationKind =
  | "enrolment.assigned"
  | "enrolment.due_soon"
  | "enrolment.overdue"
  | "assessment.waiting"
  | "moderation.waiting"
  | "assessment.referred_back"
  | "assessment.decided"
  | "certificate.issued"
  | "programme.step_unlocked";

export type RaiseInput = {
  organisationId: string;
  userId: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  linkPath?: string;
  entityType?: string;
  entityId?: string;
  dedupeKey: string;
  /** In-app only by default; email is added when it is worth an interruption. */
  channels?: ("in_app" | "email")[];
};

/**
 * Records a notification, or does nothing if the same one already exists.
 *
 * Takes a transaction so a notification is raised with the thing that caused
 * it: if the enrolment rolls back, so does the message telling somebody about
 * it. A notification about something that did not happen is worse than none.
 */
export async function raise(
  tx: TenantDatabase,
  input: RaiseInput,
): Promise<void> {
  const channels = input.channels ?? ["in_app"];

  await tx
    .insert(notifications)
    .values(
      channels.map((channel) => ({
        organisationId: input.organisationId,
        userId: input.userId,
        channel,
        kind: input.kind,
        subject: input.subject,
        body: input.body,
        linkPath: input.linkPath ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey,
        // In-app messages are "delivered" the moment they are written; there
        // is nowhere else for them to go.
        status: channel === "in_app" ? ("sent" as const) : ("pending" as const),
        sentAt: channel === "in_app" ? new Date() : null,
      })),
    )
    .onConflictDoNothing();
}

/** Everyone in the tenant holding a role, for notifications aimed at a job. */
export async function usersWithRole(
  tx: TenantDatabase,
  role: "assessor" | "moderator" | "tenant_admin" | "line_manager",
): Promise<string[]> {
  const rows = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.role, role),
        isNull(userRoles.revokedAt),
        eq(users.status, "active"),
      ),
    );

  return [...new Set(rows.map((row) => row.userId))];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function myNotifications(
  session: AuthenticatedSession,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        subject: notifications.subject,
        body: notifications.body,
        linkPath: notifications.linkPath,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, session.userId),
          eq(notifications.channel, "in_app"),
          options.unreadOnly ? isNull(notifications.readAt) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(options.limit ?? 50),
  );
}

export async function unreadCount(
  session: AuthenticatedSession,
): Promise<number> {
  const [row] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, session.userId),
          eq(notifications.channel, "in_app"),
          isNull(notifications.readAt),
        ),
      ),
  );

  return row?.total ?? 0;
}

export async function markRead(
  session: AuthenticatedSession,
  notificationId: string,
) {
  await withTenant(session.organisationId, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      // Scoped to the reader: marking somebody else's notification read would
      // hide something they had not seen.
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, session.userId),
        ),
      ),
  );
}

export async function markAllRead(session: AuthenticatedSession) {
  await withTenant(session.organisationId, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, session.userId),
          eq(notifications.channel, "in_app"),
          isNull(notifications.readAt),
        ),
      ),
  );
}

// ---------------------------------------------------------------------------
// The scheduled sweep
// ---------------------------------------------------------------------------

/** Bucket a date into a week, so a reminder repeats weekly rather than nightly. */
function weekBucket(date = new Date()): string {
  const copy = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay());
  return copy.toISOString().slice(0, 10);
}

export type SweepResult = {
  dueSoon: number;
  overdue: number;
  awaitingAssessor: number;
  awaitingModerator: number;
};

/**
 * Looks for things somebody should be told about and queues the messages.
 *
 * Run on a schedule. Safe to run repeatedly: the dedupe key means a second run
 * on the same day changes nothing.
 */
export async function sweepTenant(
  organisationId: string,
  now = new Date(),
): Promise<SweepResult> {
  const result: SweepResult = {
    dueSoon: 0,
    overdue: 0,
    awaitingAssessor: 0,
    awaitingModerator: 0,
  };

  await withTenant(organisationId, async (tx) => {
    const week = weekBucket(now);
    const soon = new Date(now.getTime() + 7 * 86_400_000);

    // --- training due within a week, not yet finished ----------------------
    const dueSoon = await tx
      .select({
        enrolmentId: enrolments.id,
        userId: enrolments.userId,
        dueDate: enrolments.dueDate,
        courseTitle: courses.title,
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(
        and(
          inArray(enrolments.status, ["assigned", "in_progress"]),
          lte(enrolments.dueDate, soon),
          // gt(), not a raw fragment: a Date interpolated into raw SQL cannot
          // be bound as a parameter and fails at the driver.
          gt(enrolments.dueDate, now),
        ),
      );

    for (const row of dueSoon) {
      const days = Math.max(
        1,
        Math.ceil((row.dueDate!.getTime() - now.getTime()) / 86_400_000),
      );

      await raise(tx, {
        organisationId,
        userId: row.userId,
        kind: "enrolment.due_soon",
        subject: `"${row.courseTitle}" is due in ${days} ${days === 1 ? "day" : "days"}`,
        body: `You have not finished "${row.courseTitle}" yet. It is due on ${row.dueDate!.toLocaleDateString("en-ZA")}.`,
        linkPath: `/learn/${row.enrolmentId}`,
        entityType: "enrolment",
        entityId: row.enrolmentId,
        dedupeKey: `due_soon:${row.enrolmentId}:${week}`,
        channels: ["in_app", "email"],
      });
      result.dueSoon += 1;
    }

    // --- overdue -----------------------------------------------------------
    const overdue = await tx
      .select({
        enrolmentId: enrolments.id,
        userId: enrolments.userId,
        dueDate: enrolments.dueDate,
        courseTitle: courses.title,
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(eq(enrolments.status, "overdue"));

    // A line manager hears about their own reports, so the reminder does not
    // rest entirely on the person who is already not doing it.
    const managers = await tx
      .select({ userId: users.id, managerId: users.lineManagerId })
      .from(users)
      .where(eq(users.status, "active"));

    const managerOf = new Map(
      managers.map((row) => [row.userId, row.managerId]),
    );

    for (const row of overdue) {
      await raise(tx, {
        organisationId,
        userId: row.userId,
        kind: "enrolment.overdue",
        subject: `"${row.courseTitle}" is overdue`,
        body: `"${row.courseTitle}" was due on ${row.dueDate?.toLocaleDateString("en-ZA") ?? "an earlier date"} and has not been finished.`,
        linkPath: `/learn/${row.enrolmentId}`,
        entityType: "enrolment",
        entityId: row.enrolmentId,
        dedupeKey: `overdue:${row.enrolmentId}:${week}`,
        channels: ["in_app", "email"],
      });
      result.overdue += 1;

      const managerId = managerOf.get(row.userId);
      if (managerId) {
        const [learner] = await tx
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, row.userId));

        await raise(tx, {
          organisationId,
          userId: managerId,
          kind: "enrolment.overdue",
          subject: `${learner.firstName} ${learner.lastName} has overdue training`,
          body: `"${row.courseTitle}" was due on ${row.dueDate?.toLocaleDateString("en-ZA") ?? "an earlier date"}.`,
          linkPath: "/reports",
          entityType: "enrolment",
          entityId: row.enrolmentId,
          dedupeKey: `overdue_manager:${row.enrolmentId}:${week}`,
        });
      }
    }

    // --- work waiting for an assessor --------------------------------------
    const [{ waiting }] = await tx
      .select({ waiting: count() })
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.status, "submitted"));

    if (waiting > 0) {
      for (const assessorId of await usersWithRole(tx, "assessor")) {
        await raise(tx, {
          organisationId,
          userId: assessorId,
          kind: "assessment.waiting",
          subject: `${waiting} ${waiting === 1 ? "submission is" : "submissions are"} waiting to be assessed`,
          body: "Learners are waiting on a competency decision.",
          linkPath: "/assess",
          dedupeKey: `assess_waiting:${assessorId}:${week}`,
        });
        result.awaitingAssessor += 1;
      }
    }

    // --- work waiting for a moderator --------------------------------------
    const [{ queued }] = await tx
      .select({ queued: count() })
      .from(moderationQueue)
      .where(isNull(moderationQueue.resolvedAt));

    if (queued > 0) {
      for (const moderatorId of await usersWithRole(tx, "moderator")) {
        await raise(tx, {
          organisationId,
          userId: moderatorId,
          kind: "moderation.waiting",
          subject: `${queued} ${queued === 1 ? "decision is" : "decisions are"} waiting for moderation`,
          body: "Assessor decisions have been sampled for independent review.",
          linkPath: "/moderate",
          dedupeKey: `moderate_waiting:${moderatorId}:${week}`,
        });
        result.awaitingModerator += 1;
      }
    }
  });

  return result;
}

/** Runs the sweep for every active tenant. Used by the scheduled job. */
export async function sweepAllTenants(now = new Date()) {
  const tenants = await withPlatformScope(
    "scheduled notification sweep across all tenants",
    (tx) =>
      tx
        .select({ id: organisations.id, name: organisations.displayName })
        .from(organisations)
        .where(eq(organisations.status, "active"))
        .orderBy(asc(organisations.displayName)),
  );

  const results: { tenant: string; result: SweepResult }[] = [];

  for (const tenant of tenants) {
    results.push({
      tenant: tenant.name,
      result: await sweepTenant(tenant.id, now),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// The outbox
// ---------------------------------------------------------------------------

export type PendingEmail = {
  id: string;
  organisationId: string;
  email: string;
  firstName: string;
  subject: string;
  body: string;
  linkPath: string | null;
  attempts: number;
};

/** Email notifications waiting to go out, oldest first. */
export async function pendingEmails(limit = 100): Promise<PendingEmail[]> {
  return withPlatformScope(
    "draining the notification outbox for delivery",
    (tx) =>
      tx
        .select({
          id: notifications.id,
          organisationId: notifications.organisationId,
          email: users.email,
          firstName: users.firstName,
          subject: notifications.subject,
          body: notifications.body,
          linkPath: notifications.linkPath,
          attempts: notifications.attempts,
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(
          and(
            eq(notifications.channel, "email"),
            eq(notifications.status, "pending"),
            // Anonymised accounts have no working address, and a suspended
            // person should not be chased.
            eq(users.status, "active"),
          ),
        )
        .orderBy(asc(notifications.createdAt))
        .limit(limit),
  );
}

export async function markEmailSent(notificationId: string) {
  await withPlatformScope("recording a delivered notification", (tx) =>
    tx
      .update(notifications)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(notifications.id, notificationId)),
  );
}

/**
 * Records a failure. After several attempts the message is given up on rather
 * than retried forever — a permanently bad address would otherwise be tried
 * on every run until somebody noticed.
 */
export async function markEmailFailed(
  notificationId: string,
  error: string,
  giveUpAfter = 5,
) {
  await withPlatformScope("recording a failed delivery", async (tx) => {
    const [row] = await tx
      .select({ attempts: notifications.attempts })
      .from(notifications)
      .where(eq(notifications.id, notificationId));

    const attempts = (row?.attempts ?? 0) + 1;

    await tx
      .update(notifications)
      .set({
        attempts,
        lastError: error.slice(0, 500),
        status: attempts >= giveUpAfter ? "failed" : "pending",
      })
      .where(eq(notifications.id, notificationId));
  });
}

export { notifications as notificationsTable };
