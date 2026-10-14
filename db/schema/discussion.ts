import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { courses } from "./curriculum";

/**
 * A discussion board for each course, which is each study unit too (job sheet
 * D30, Roland, 14 October 2026: "Build the discussion boards", from Curiosa's
 * evaluation checklist asking for "discussion boards that foster active
 * critical thinking").
 *
 * Learners enrolled on the course and the staff named on its programme read
 * and post. A facilitator can pin a thread, close it to replies, and remove a
 * post; a removed post keeps its row, so what was said stays on the record.
 */
export const discussionThreads = pgTable(
  "discussion_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    /** Kept at the top of the board: a reflection question, house rules. */
    pinned: boolean("pinned").notNull().default(false),
    /** Closed to replies; still readable. */
    locked: boolean("locked").notNull().default(false),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenById: uuid("hidden_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the latest post was made, so the board lists the liveliest first. */
    lastPostAt: timestamp("last_post_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("discussion_threads_course_idx").on(t.courseId),
    index("discussion_threads_org_idx").on(t.organisationId),
  ],
);

export const discussionPosts = pgTable(
  "discussion_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => discussionThreads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenById: uuid("hidden_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("discussion_posts_thread_idx").on(t.threadId),
    index("discussion_posts_org_idx").on(t.organisationId),
  ],
);
