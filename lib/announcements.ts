/**
 * A facilitator's announcements to a cohort.
 *
 * Heidi's role specifications (job sheet D52 (1), 17 November 2026): a
 * facilitator posts announcements to their cohort. Each is kept against the
 * cohort and reaches every learner still in it as a notification, by email as
 * well where the facilitator chooses, so it is read whether or not the learner
 * opens the platform that day.
 *
 * Who may post: whoever may manage class sessions (a facilitator, an
 * administrator), within the cohorts they are assigned to (lib/staff-scope.ts).
 * Who may read: the same staff, and the cohort's own learners.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { cohortAnnouncements, cohortMembers, cohorts, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { raise } from "./notifications";
import { CohortError } from "./cohorts";
import { inReach, reachWithin } from "./staff-scope";
import { assertSessionCan, type AuthenticatedSession } from "./session";

export type Announcement = {
  id: string;
  subject: string;
  body: string;
  emailed: boolean;
  postedAt: Date;
  author: string | null;
};

export async function postAnnouncement(
  session: AuthenticatedSession,
  input: { cohortId: string; subject: string; body: string; email: boolean },
): Promise<{ id: string; reached: number }> {
  assertSessionCan(session, "session:manage");
  const subject = input.subject.replace(/\s+/g, " ").trim();
  const body = input.body.trim();
  if (subject.length < 3 || subject.length > 150) throw new CohortError("Give the announcement a subject of 3 to 150 characters.", "invalid");
  if (body.length < 1 || body.length > 5000) throw new CohortError("Write the announcement, in up to 5,000 characters.", "invalid");

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select({ id: cohorts.id, name: cohorts.name }).from(cohorts).where(eq(cohorts.id, input.cohortId));
    if (!cohort) throw new CohortError("No such cohort.", "not_found");
    if (!inReach(await reachWithin(tx, session), { cohortId: cohort.id })) {
      throw new CohortError("This is not one of the cohorts you are assigned to.", "not_permitted");
    }

    const [made] = await tx
      .insert(cohortAnnouncements)
      .values({ organisationId: session.organisationId, cohortId: cohort.id, authorId: session.userId, subject, body, emailed: input.email })
      .returning({ id: cohortAnnouncements.id });

    const learners = await tx
      .select({ userId: cohortMembers.userId })
      .from(cohortMembers)
      .where(and(eq(cohortMembers.cohortId, cohort.id), isNull(cohortMembers.leftAt)));
    for (const learner of learners) {
      await raise(tx, {
        organisationId: session.organisationId,
        userId: learner.userId,
        kind: "cohort.announcement",
        subject: `${cohort.name}: ${subject}`,
        body,
        linkPath: `/announcements/${made.id}`,
        entityType: "cohort_announcement",
        entityId: made.id,
        dedupeKey: `cohort.announcement:${made.id}:${learner.userId}`,
        channels: input.email ? ["in_app", "email"] : ["in_app"],
      });
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.announcement_posted",
      entityType: "cohort",
      entityId: cohort.id,
      after: { announcementId: made.id, subject, emailed: input.email, learners: learners.length },
    });
    return { id: made.id, reached: learners.length };
  });
}

/** May this person read this cohort's announcements: its staff within reach, or one of its learners. */
async function mayRead(tx: Parameters<Parameters<typeof withTenant>[1]>[0], session: AuthenticatedSession, cohortId: string): Promise<boolean> {
  if (session.permissions.includes("enrolment:read_all") && inReach(await reachWithin(tx, session), { cohortId })) return true;
  const [member] = await tx
    .select({ id: cohortMembers.id })
    .from(cohortMembers)
    .where(and(eq(cohortMembers.cohortId, cohortId), eq(cohortMembers.userId, session.userId)));
  return Boolean(member);
}

export async function cohortAnnouncementList(session: AuthenticatedSession, cohortId: string): Promise<Announcement[]> {
  return withTenant(session.organisationId, async (tx) => {
    if (!(await mayRead(tx, session, cohortId))) return [];
    const rows = await tx
      .select({
        id: cohortAnnouncements.id,
        subject: cohortAnnouncements.subject,
        body: cohortAnnouncements.body,
        emailed: cohortAnnouncements.emailed,
        postedAt: cohortAnnouncements.postedAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(cohortAnnouncements)
      .leftJoin(users, eq(users.id, cohortAnnouncements.authorId))
      .where(eq(cohortAnnouncements.cohortId, cohortId))
      .orderBy(desc(cohortAnnouncements.postedAt));
    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      body: row.body,
      emailed: row.emailed,
      postedAt: row.postedAt,
      author: row.firstName ? `${row.firstName} ${row.lastName ?? ""}`.trim() : null,
    }));
  });
}

/** One announcement, for the page a notification links to. */
export async function getAnnouncement(
  session: AuthenticatedSession,
  id: string,
): Promise<(Announcement & { cohortId: string; cohortName: string }) | null> {
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        id: cohortAnnouncements.id,
        cohortId: cohortAnnouncements.cohortId,
        cohortName: cohorts.name,
        subject: cohortAnnouncements.subject,
        body: cohortAnnouncements.body,
        emailed: cohortAnnouncements.emailed,
        postedAt: cohortAnnouncements.postedAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(cohortAnnouncements)
      .innerJoin(cohorts, eq(cohorts.id, cohortAnnouncements.cohortId))
      .leftJoin(users, eq(users.id, cohortAnnouncements.authorId))
      .where(eq(cohortAnnouncements.id, id));
    if (!row || !(await mayRead(tx, session, row.cohortId))) return null;
    return {
      id: row.id,
      cohortId: row.cohortId,
      cohortName: row.cohortName,
      subject: row.subject,
      body: row.body,
      emailed: row.emailed,
      postedAt: row.postedAt,
      author: row.firstName ? `${row.firstName} ${row.lastName ?? ""}`.trim() : null,
    };
  });
}
