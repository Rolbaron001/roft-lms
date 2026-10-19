import { boolean, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { courses } from "./curriculum";

/**
 * The pre-assessment checklist and declaration a learner completes before a
 * study unit opens (job sheet D32; Heidi, 19 October 2026: "Pre-assessment
 * declaration to be included before every SU. Checklist for learner to
 * complete before being allowed to continue with the SU"). The wording is the
 * provider's own, set in Settings; the default is the checklist Cecelia drew
 * up for Curiosa from the SETA and QCTO assessment guidelines.
 */
export const preAssessmentChecklists = pgTable(
  "pre_assessment_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Off until the provider switches it on: a gate is the provider's choice. */
    enabled: boolean("enabled").notNull().default(false),
    items: jsonb("items").$type<{ title: string; detail: string }[]>().notNull(),
    introduction: text("introduction").notNull(),
    declaration: text("declaration").notNull(),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pre_assessment_checklists_org_idx").on(t.organisationId)],
);

/**
 * One learner's confirmation for one study unit, with the exact items and
 * declaration they confirmed, so the record shows what was agreed and not
 * only that something was.
 */
export const preAssessmentConfirmations = pgTable(
  "pre_assessment_confirmations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Its key named below: the default name runs past PostgreSQL's 63 characters.
    organisationId: uuid("organisation_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    items: jsonb("items").$type<{ title: string; detail: string }[]>().notNull(),
    declaration: text("declaration").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
  },
  (t) => [
    foreignKey({
      name: "pre_assessment_confirmations_org_fk",
      columns: [t.organisationId],
      foreignColumns: [organisations.id],
    }).onDelete("cascade"),
    uniqueIndex("pre_assessment_confirmations_unique_idx").on(t.userId, t.courseId),
    index("pre_assessment_confirmations_org_idx").on(t.organisationId),
  ],
);
