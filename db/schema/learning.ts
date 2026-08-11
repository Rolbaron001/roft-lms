import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { courses, learningPaths, lessons, qualifications } from "./curriculum";

export const enrolmentStatus = pgEnum("enrolment_status", [
  "assigned",
  "in_progress",
  "completed",
  "overdue",
  "withdrawn",
  "superseded",
]);

export const progressState = pgEnum("progress_state", [
  "not_started",
  "in_progress",
  "completed",
]);

/**
 * A learner's assignment to a course or a learning path. Exactly one of
 * courseId or learningPathId is set; the check constraint is added in the
 * migration alongside the row-level security policies.
 */
export const enrolments = pgTable(
  "enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "cascade",
    }),
    learningPathId: uuid("learning_path_id").references(() => learningPaths.id, {
      onDelete: "cascade",
    }),
    /** Set when the enrolment counts towards an accredited qualification. */
    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "set null" },
    ),

    status: enrolmentStatus("status").notNull().default("assigned"),
    /** How the learner came to be enrolled: manual, bulk upload, group rule, HRIS. */
    enrolmentSource: text("enrolment_source").notNull().default("manual"),
    enrolledById: uuid("enrolled_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    dueDate: timestamp("due_date", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("enrolments_org_idx").on(t.organisationId),
    index("enrolments_user_idx").on(t.userId),
    index("enrolments_course_idx").on(t.courseId),
    uniqueIndex("enrolments_user_course_idx").on(t.userId, t.courseId),
  ],
);

/** Completion state for one lesson within one enrolment. */
export const progressRecords = pgTable(
  "progress_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolments.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    state: progressState("state").notNull().default("not_started"),
    timeSpentSeconds: integer("time_spent_seconds").notNull().default(0),
    /** SCORM/cmi5 bookmark, so a learner resumes where they stopped. */
    resumeData: text("resume_data"),
    firstAccessedAt: timestamp("first_accessed_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("progress_records_unique_idx").on(t.enrolmentId, t.lessonId),
    index("progress_records_org_idx").on(t.organisationId),
  ],
);
