import { date, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { courses, learningPaths, qualifications, studyUnits } from "./curriculum";

/**
 * Who delivers, assesses and moderates what (job sheet D27, Roland, 9 October
 * 2026: "Where are facilitators, assessors, moderators and any other relevant
 * role-player assigned to a Qualification and/or Study Unit?"). Until then
 * nowhere: a role was organisation-wide, and every assessor saw every
 * submission.
 *
 * One row names one person in one capacity on one thing: a qualification
 * (full or part, or a skills programme), one of its study units, a course, or
 * a programme. Exactly one of the four is set. A study unit's people are its
 * own if it names any, and its qualification's otherwise; a course that is a
 * study unit's follows the same rule.
 */
export const staffCapacity = pgEnum("staff_capacity", ["facilitator", "assessor", "moderator"]);

export const programmeStaff = pgTable(
  "programme_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    capacity: staffCapacity("capacity").notNull(),

    qualificationId: uuid("qualification_id").references(() => qualifications.id, { onDelete: "cascade" }),
    studyUnitId: uuid("study_unit_id").references(() => studyUnits.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "cascade" }),
    learningPathId: uuid("learning_path_id").references(() => learningPaths.id, { onDelete: "cascade" }),

    /**
     * An assessor's or moderator's registration for this programme, where the
     * provider records one: registration is held against particular
     * qualifications, not in general.
     */
    registrationNumber: text("registration_number"),
    registrationExpiresOn: date("registration_expires_on"),

    assignedById: uuid("assigned_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("programme_staff_user_idx").on(t.organisationId, t.userId),
    index("programme_staff_qualification_idx").on(t.qualificationId),
    index("programme_staff_unit_idx").on(t.studyUnitId),
    index("programme_staff_course_idx").on(t.courseId),
  ],
);
