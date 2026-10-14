import { and, asc, count, desc, eq, inArray, isNull, max, notInArray } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import { courses, discussionPosts, discussionThreads, enrolments, userRoles, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { raise } from "./notifications";
import type { AuthenticatedSession } from "./session";
import { coursesWithin, inReach, reachWithin } from "./staff-scope";
import type { Role } from "./rbac";

/**
 * Discussion boards, one to each course and so to each study unit (job sheet
 * D30, 14 October 2026).
 *
 * Who reads and posts is decided the way everything else is: a learner on the
 * boards of the courses they are enrolled on, staff on the boards of the
 * programmes they are named on (lib/staff-scope.ts), and anyone who sees the
 * whole provider on every board. Staff also moderate: pin, close to replies,
 * and remove a post. A removed post keeps its row and its words, shown to
 * staff and replaced for everybody else, so what was said stays on the record.
 */

export class DiscussionError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "not_permitted" | "invalid" | "closed",
  ) {
    super(message);
    this.name = "DiscussionError";
  }
}

const STAFF_ROLES: Role[] = ["tenant_admin", "tenant_viewer", "instructor", "assessor", "moderator", "skills_development_facilitator", "external_verifier"];
const ACTIVE = ["withdrawn", "superseded"] as const;

const TITLE_MAX = 200;
const BODY_MAX = 10_000;

function isStaff(session: AuthenticatedSession): boolean {
  return session.roles.some((role) => STAFF_ROLES.includes(role));
}

export type BoardAccess = { read: boolean; post: boolean; moderate: boolean };

/** What this person may do on one course's board. */
async function accessTo(tx: TenantDatabase, session: AuthenticatedSession, courseId: string): Promise<BoardAccess> {
  if (isStaff(session)) {
    const reach = await reachWithin(tx, session);
    if (inReach(reach, { courseId })) return { read: true, post: true, moderate: true };
  }
  const [enrolled] = await tx
    .select({ id: enrolments.id })
    .from(enrolments)
    .where(
      and(
        eq(enrolments.userId, session.userId),
        eq(enrolments.courseId, courseId),
        notInArray(enrolments.status, [...ACTIVE]),
      ),
    )
    .limit(1);
  return enrolled ? { read: true, post: true, moderate: false } : { read: false, post: false, moderate: false };
}

async function requireAccess(tx: TenantDatabase, session: AuthenticatedSession, courseId: string) {
  const access = await accessTo(tx, session, courseId);
  if (!access.read) throw new DiscussionError("This discussion is for the people on that course.", "not_permitted");
  return access;
}

function cleanTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ");
  if (title.length < 3) throw new DiscussionError("Give the discussion a title.", "invalid");
  if (title.length > TITLE_MAX) throw new DiscussionError(`Keep the title under ${TITLE_MAX} characters.`, "invalid");
  return title;
}

function cleanBody(value: string): string {
  const body = value.trim();
  if (body.length < 2) throw new DiscussionError("Write something to post.", "invalid");
  if (body.length > BODY_MAX) throw new DiscussionError(`Keep a post under ${BODY_MAX} characters.`, "invalid");
  return body;
}

// ---------------------------------------------------------------------------
// The boards a person has
// ---------------------------------------------------------------------------

export type BoardSummary = {
  courseId: string;
  title: string;
  threads: number;
  lastPostAt: Date | null;
};

/** Every board this person may read, the liveliest first. */
export async function myBoards(session: AuthenticatedSession): Promise<BoardSummary[]> {
  return withTenant(session.organisationId, async (tx) => {
    let ids: string[];
    if (isStaff(session)) {
      const reach = await reachWithin(tx, session);
      const rows = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.status, "published"), coursesWithin(reach, courses.id)));
      ids = rows.map((row) => row.id);
    } else {
      ids = [];
    }
    const own = await tx
      .select({ courseId: enrolments.courseId })
      .from(enrolments)
      .where(and(eq(enrolments.userId, session.userId), notInArray(enrolments.status, [...ACTIVE])));
    ids = [...new Set([...ids, ...own.map((row) => row.courseId).filter((id): id is string => Boolean(id))])];
    if (ids.length === 0) return [];

    const titles = await tx.select({ id: courses.id, title: courses.title }).from(courses).where(inArray(courses.id, ids));
    const activity = await tx
      .select({ courseId: discussionThreads.courseId, threads: count(), last: max(discussionThreads.lastPostAt) })
      .from(discussionThreads)
      .where(and(inArray(discussionThreads.courseId, ids), isNull(discussionThreads.hiddenAt)))
      .groupBy(discussionThreads.courseId);
    const byCourse = new Map(activity.map((row) => [row.courseId, row]));

    return titles
      .map((row) => ({
        courseId: row.id,
        title: row.title,
        threads: byCourse.get(row.id)?.threads ?? 0,
        lastPostAt: byCourse.get(row.id)?.last ?? null,
      }))
      .sort(
        (a, b) =>
          (b.lastPostAt?.getTime() ?? 0) - (a.lastPostAt?.getTime() ?? 0) || a.title.localeCompare(b.title),
      );
  });
}

// ---------------------------------------------------------------------------
// One board
// ---------------------------------------------------------------------------

export type ThreadSummary = {
  id: string;
  title: string;
  authorName: string;
  authorIsStaff: boolean;
  pinned: boolean;
  locked: boolean;
  hidden: boolean;
  replies: number;
  lastPostAt: Date;
};

export type Board = {
  courseId: string;
  courseTitle: string;
  access: BoardAccess;
  threads: ThreadSummary[];
};

export async function getBoard(session: AuthenticatedSession, courseId: string): Promise<Board> {
  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx.select({ id: courses.id, title: courses.title }).from(courses).where(eq(courses.id, courseId));
    if (!course) throw new DiscussionError("No such course.", "not_found");
    const access = await requireAccess(tx, session, courseId);

    const threads = await tx
      .select({
        id: discussionThreads.id,
        title: discussionThreads.title,
        authorId: discussionThreads.authorId,
        firstName: users.firstName,
        lastName: users.lastName,
        pinned: discussionThreads.pinned,
        locked: discussionThreads.locked,
        hiddenAt: discussionThreads.hiddenAt,
        lastPostAt: discussionThreads.lastPostAt,
      })
      .from(discussionThreads)
      .innerJoin(users, eq(users.id, discussionThreads.authorId))
      .where(
        and(
          eq(discussionThreads.courseId, courseId),
          access.moderate ? undefined : isNull(discussionThreads.hiddenAt),
        ),
      )
      .orderBy(desc(discussionThreads.pinned), desc(discussionThreads.lastPostAt));

    const counts = threads.length
      ? await tx
          .select({ threadId: discussionPosts.threadId, posts: count() })
          .from(discussionPosts)
          .where(and(inArray(discussionPosts.threadId, threads.map((row) => row.id)), isNull(discussionPosts.hiddenAt)))
          .groupBy(discussionPosts.threadId)
      : [];
    const postsOf = new Map(counts.map((row) => [row.threadId, row.posts]));
    const staff = await staffAmong(tx, threads.map((row) => row.authorId));

    return {
      courseId,
      courseTitle: course.title,
      access,
      threads: threads.map((row) => ({
        id: row.id,
        title: row.title,
        authorName: `${row.firstName} ${row.lastName}`,
        authorIsStaff: staff.has(row.authorId),
        pinned: row.pinned,
        locked: row.locked,
        hidden: row.hiddenAt !== null,
        replies: Math.max(0, (postsOf.get(row.id) ?? 1) - 1),
        lastPostAt: row.lastPostAt,
      })),
    };
  });
}

/** Which of these people hold a staff role, so their posts can say so. */
async function staffAmong(tx: TenantDatabase, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await tx
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(inArray(userRoles.userId, [...new Set(userIds)]), inArray(userRoles.role, STAFF_ROLES), isNull(userRoles.revokedAt)));
  return new Set(rows.map((row) => row.userId));
}

// ---------------------------------------------------------------------------
// One thread
// ---------------------------------------------------------------------------

export type PostView = {
  id: string;
  authorId: string;
  authorName: string;
  authorIsStaff: boolean;
  /** Null to a learner when the post was removed. */
  body: string | null;
  hidden: boolean;
  createdAt: Date;
  mine: boolean;
};

export type ThreadView = {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  pinned: boolean;
  locked: boolean;
  hidden: boolean;
  access: BoardAccess;
  posts: PostView[];
};

export async function getThread(session: AuthenticatedSession, threadId: string): Promise<ThreadView> {
  return withTenant(session.organisationId, async (tx) => {
    const [thread] = await tx
      .select({
        id: discussionThreads.id,
        courseId: discussionThreads.courseId,
        title: discussionThreads.title,
        pinned: discussionThreads.pinned,
        locked: discussionThreads.locked,
        hiddenAt: discussionThreads.hiddenAt,
        courseTitle: courses.title,
      })
      .from(discussionThreads)
      .innerJoin(courses, eq(courses.id, discussionThreads.courseId))
      .where(eq(discussionThreads.id, threadId));
    if (!thread) throw new DiscussionError("No such discussion.", "not_found");
    const access = await requireAccess(tx, session, thread.courseId);
    if (thread.hiddenAt && !access.moderate) throw new DiscussionError("No such discussion.", "not_found");

    const posts = await tx
      .select({
        id: discussionPosts.id,
        authorId: discussionPosts.authorId,
        firstName: users.firstName,
        lastName: users.lastName,
        body: discussionPosts.body,
        hiddenAt: discussionPosts.hiddenAt,
        createdAt: discussionPosts.createdAt,
      })
      .from(discussionPosts)
      .innerJoin(users, eq(users.id, discussionPosts.authorId))
      .where(eq(discussionPosts.threadId, threadId))
      .orderBy(asc(discussionPosts.createdAt));
    const staff = await staffAmong(tx, posts.map((row) => row.authorId));

    return {
      id: thread.id,
      courseId: thread.courseId,
      courseTitle: thread.courseTitle,
      title: thread.title,
      pinned: thread.pinned,
      locked: thread.locked,
      hidden: thread.hiddenAt !== null,
      access,
      posts: posts.map((row) => ({
        id: row.id,
        authorId: row.authorId,
        authorName: `${row.firstName} ${row.lastName}`,
        authorIsStaff: staff.has(row.authorId),
        body: row.hiddenAt && !access.moderate ? null : row.body,
        hidden: row.hiddenAt !== null,
        createdAt: row.createdAt,
        mine: row.authorId === session.userId,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export async function startThread(
  session: AuthenticatedSession,
  input: { courseId: string; title: string; body: string },
): Promise<string> {
  const title = cleanTitle(input.title);
  const body = cleanBody(input.body);

  return withTenant(session.organisationId, async (tx) => {
    const access = await requireAccess(tx, session, input.courseId);
    if (!access.post) throw new DiscussionError("You cannot post here.", "not_permitted");

    const [thread] = await tx
      .insert(discussionThreads)
      .values({ organisationId: session.organisationId, courseId: input.courseId, authorId: session.userId, title })
      .returning({ id: discussionThreads.id });
    const [post] = await tx
      .insert(discussionPosts)
      .values({ organisationId: session.organisationId, threadId: thread.id, authorId: session.userId, body })
      .returning({ id: discussionPosts.id });

    // A question put by the facilitator reaches every learner on the course;
    // a learner's own thread is found on the board.
    if (access.moderate) {
      const [course] = await tx.select({ title: courses.title }).from(courses).where(eq(courses.id, input.courseId));
      const learners = await tx
        .selectDistinct({ userId: enrolments.userId })
        .from(enrolments)
        .where(and(eq(enrolments.courseId, input.courseId), notInArray(enrolments.status, [...ACTIVE])));
      for (const learner of learners) {
        if (learner.userId === session.userId) continue;
        await raise(tx, {
          organisationId: session.organisationId,
          userId: learner.userId,
          kind: "discussion.started",
          subject: `New discussion on ${course?.title ?? "your course"}: ${title}`,
          body: body.slice(0, 200),
          linkPath: `/discussions/thread/${thread.id}`,
          entityType: "discussion_thread",
          entityId: thread.id,
          dedupeKey: `discussion:${post.id}`,
        });
      }
    }

    return thread.id;
  });
}

export async function reply(session: AuthenticatedSession, input: { threadId: string; body: string }): Promise<string> {
  const body = cleanBody(input.body);

  return withTenant(session.organisationId, async (tx) => {
    const [thread] = await tx.select().from(discussionThreads).where(eq(discussionThreads.id, input.threadId));
    if (!thread) throw new DiscussionError("No such discussion.", "not_found");
    const access = await requireAccess(tx, session, thread.courseId);
    if (thread.hiddenAt) throw new DiscussionError("This discussion has been removed.", "closed");
    if (thread.locked && !access.moderate) throw new DiscussionError("This discussion is closed to replies.", "closed");

    const [post] = await tx
      .insert(discussionPosts)
      .values({ organisationId: session.organisationId, threadId: thread.id, authorId: session.userId, body })
      .returning({ id: discussionPosts.id, createdAt: discussionPosts.createdAt });
    await tx.update(discussionThreads).set({ lastPostAt: post.createdAt }).where(eq(discussionThreads.id, thread.id));

    // Everybody who has posted in it, bar the person replying.
    const taking = await tx
      .selectDistinct({ userId: discussionPosts.authorId })
      .from(discussionPosts)
      .where(and(eq(discussionPosts.threadId, thread.id), isNull(discussionPosts.hiddenAt)));
    const [me] = await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, session.userId));
    for (const one of taking) {
      if (one.userId === session.userId) continue;
      await raise(tx, {
        organisationId: session.organisationId,
        userId: one.userId,
        kind: "discussion.reply",
        subject: `${me ? `${me.firstName} ${me.lastName}` : "Someone"} replied in "${thread.title}"`,
        body: body.slice(0, 200),
        linkPath: `/discussions/thread/${thread.id}#post-${post.id}`,
        entityType: "discussion_thread",
        entityId: thread.id,
        dedupeKey: `discussion:${post.id}`,
      });
    }

    return post.id;
  });
}

// ---------------------------------------------------------------------------
// Moderating
// ---------------------------------------------------------------------------

/**
 * Removes a post: its author may remove their own, staff any on their boards.
 * Removing the opening post removes the discussion.
 */
export async function removePost(session: AuthenticatedSession, postId: string): Promise<string> {
  return withTenant(session.organisationId, async (tx) => {
    const [post] = await tx
      .select({ id: discussionPosts.id, authorId: discussionPosts.authorId, threadId: discussionPosts.threadId, courseId: discussionThreads.courseId })
      .from(discussionPosts)
      .innerJoin(discussionThreads, eq(discussionThreads.id, discussionPosts.threadId))
      .where(eq(discussionPosts.id, postId));
    if (!post) throw new DiscussionError("No such post.", "not_found");
    const access = await requireAccess(tx, session, post.courseId);
    if (post.authorId !== session.userId && !access.moderate) {
      throw new DiscussionError("Only the author or a facilitator can remove a post.", "not_permitted");
    }

    const now = new Date();
    await tx.update(discussionPosts).set({ hiddenAt: now, hiddenById: session.userId }).where(eq(discussionPosts.id, postId));

    const [first] = await tx
      .select({ id: discussionPosts.id })
      .from(discussionPosts)
      .where(eq(discussionPosts.threadId, post.threadId))
      .orderBy(asc(discussionPosts.createdAt))
      .limit(1);
    if (first?.id === postId) {
      await tx.update(discussionThreads).set({ hiddenAt: now, hiddenById: session.userId }).where(eq(discussionThreads.id, post.threadId));
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "discussion.post_removed",
      entityType: "discussion_thread",
      entityId: post.threadId,
      after: { postId, byAuthor: post.authorId === session.userId },
    });
    return post.threadId;
  });
}

/** Pins a thread to the top, or closes it to replies; staff only. */
export async function setThreadFlags(
  session: AuthenticatedSession,
  threadId: string,
  flags: { pinned?: boolean; locked?: boolean },
): Promise<void> {
  return withTenant(session.organisationId, async (tx) => {
    const [thread] = await tx.select().from(discussionThreads).where(eq(discussionThreads.id, threadId));
    if (!thread) throw new DiscussionError("No such discussion.", "not_found");
    const access = await requireAccess(tx, session, thread.courseId);
    if (!access.moderate) throw new DiscussionError("Only a facilitator can do that.", "not_permitted");

    await tx.update(discussionThreads).set(flags).where(eq(discussionThreads.id, threadId));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "discussion.thread_changed",
      entityType: "discussion_thread",
      entityId: threadId,
      before: { pinned: thread.pinned, locked: thread.locked },
      after: flags,
    });
  });
}
