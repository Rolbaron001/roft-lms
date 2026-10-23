import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("classroom_chat_session_idx").on(t.sessionId, t.sentAt),
    index("classroom_chat_org_idx").on(t.organisationId),
  ],
);
