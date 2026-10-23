import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { cohortSessions } from "./delivery";

/**
 * The LMS classroom (job sheet D41, Roland and Heidi, 23 October 2026): live
 * classes held on and from the LMS rather than in Google Meet.
 *
 * The class itself is carried by the media server; these tables hold what the
 * LMS keeps of it. Nothing of the class's sound or picture is stored here.
 */

/**
 * One stay in the classroom: from joining to leaving. A learner whose
 * connection drops and returns has two, and the register adds them up. Written
 * from the media server's reports, so it is what happened rather than what a
 * browser said happened.
 */
export const classroomPresence = pgTable(
  "classroom_presence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cohortSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The media server's name for this one connection, so its leaving can be matched. */
    connectionId: text("connection_id").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    /** Null while they are still in the class. */
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("classroom_presence_connection_idx").on(t.sessionId, t.connectionId),
    index("classroom_presence_session_idx").on(t.sessionId),
    index("classroom_presence_org_idx").on(t.organisationId),
  ],
);

/** The facilitator's notes, typed during the class and saved as they go. */
export const classroomNotes = pgTable(
  "classroom_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cohortSessions.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("classroom_notes_session_idx").on(t.sessionId),
    index("classroom_notes_org_idx").on(t.organisationId),
  ],
);

/** The class's typed chat, kept with the class. */
export const classroomChat = pgTable(
  "classroom_chat",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cohortSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** Said in a breakout group, or null in the whole class. */
    groupNumber: integer("group_number"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("classroom_chat_session_idx").on(t.sessionId, t.sentAt),
    index("classroom_chat_org_idx").on(t.organisationId),
  ],
);

/**
 * A question the facilitator puts to the class (Heidi, 23 October 2026: polls
 * from the start). Each learner answers once; the results are kept with the
 * class.
 */
export const classroomPolls = pgTable(
  "classroom_polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cohortSessions.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    options: jsonb("options").$type<string[]>().notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Closed to answers; the results are then shown to the class. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("classroom_polls_session_idx").on(t.sessionId),
    index("classroom_polls_org_idx").on(t.organisationId),
  ],
);

export const classroomPollAnswers = pgTable(
  "classroom_poll_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => classroomPolls.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The option chosen, by its position. */
    choice: integer("choice").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("classroom_poll_answers_unique_idx").on(t.pollId, t.userId),
    index("classroom_poll_answers_org_idx").on(t.organisationId),
  ],
);
