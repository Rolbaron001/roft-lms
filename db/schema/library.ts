import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { studyUnits } from "./curriculum";
import { courseSteps } from "./delivery";

/**
 * The provider's library of learning material: videos, diagrams, recordings,
 * slides and documents a learner views on a study unit's page or downloads.
 *
 * Roland, 5 October 2026: material "can initially be uploaded through the
 * Study Unit, but the same material might be relevant to different Study
 * Units (over time) and would therefore make more sense to link the same
 * material housed in a library to different units". So an item is stored
 * once and linked to as many study units as use it. Heidi, the same day:
 * learners must be able to download it, so a ranger with no signal can watch
 * it later.
 *
 * A learner reaches an item only through a study unit they are on, and only
 * once the unit (or the step it is released with) is open to them.
 */
export const libraryItems = pgTable(
  "library_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    /** What the file is, from its contents: video, image, audio, document, slides… */
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("library_items_org_idx").on(t.organisationId)],
);

/** One library item used by one study unit. */
export const libraryLinks = pgTable(
  "library_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => libraryItems.id, { onDelete: "cascade" }),
    studyUnitId: uuid("study_unit_id")
      .notNull()
      .references(() => studyUnits.id, { onDelete: "cascade" }),
    /**
     * Released together with this step, so it reaches a cohort on that step's
     * date or hand release. Null: with the study unit's first step.
     */
    releaseWithStepId: uuid("release_with_step_id").references(() => courseSteps.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("library_links_item_unit_idx").on(t.itemId, t.studyUnitId),
    index("library_links_unit_idx").on(t.studyUnitId),
    index("library_links_org_idx").on(t.organisationId),
  ],
);
