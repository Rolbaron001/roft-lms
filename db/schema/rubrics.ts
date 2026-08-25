import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";

/**
 * The marking matrix an assessor works from.
 *
 * Every Answer Guide in the example material carries the same shape: a handful
 * of dimensions down the side — theoretical knowledge, application and
 * examples, analysis and synthesis — and four levels across the top, from
 * exemplary to unsatisfactory, each with a band of marks. The cell where a
 * dimension meets a level is the sentence an assessor reads before deciding.
 *
 * This exists because it is what makes two assessors reach the same mark on
 * the same answer. A marking guide in prose describes what a good answer looks
 * like; a rubric says what each grade of answer looks like on each of the
 * things being judged, which is a different and harder question that the
 * document has already answered.
 */
export const rubrics = pgTable(
  "rubrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rubrics_org_idx").on(t.organisationId)],
);

/** One thing being judged: "Analysis and synthesis". */
export const rubricDimensions = pgTable(
  "rubric_dimensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubrics.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /**
     * How much of the mark this dimension carries, out of the rubric's
     * dimensions. Equal weighting where every dimension is 1, which is what
     * the example guides use.
     */
    weight: integer("weight").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("rubric_dimensions_rubric_idx").on(t.rubricId, t.sortOrder),
    index("rubric_dimensions_org_idx").on(t.organisationId),
  ],
);

/**
 * A grade of answer, and the share of the marks it earns.
 *
 * Bands are percentages rather than marks because the same rubric marks a
 * ten-mark question and a twenty-mark one. The guide states them as "8.0 - 10.0
 * Marks (80% - 100%)"; the percentage is the part that travels.
 */
export const rubricLevels = pgTable(
  "rubric_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubrics.id, { onDelete: "cascade" }),
    /** "Level 3: Competent / Meeting Standard". */
    label: text("label").notNull(),
    minPercent: integer("min_percent").notNull(),
    maxPercent: integer("max_percent").notNull(),
    /** Highest first, the way the guides print them. */
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("rubric_levels_rubric_idx").on(t.rubricId, t.sortOrder),
    index("rubric_levels_org_idx").on(t.organisationId),
  ],
);

/** The cell: what this level looks like on this dimension. */
export const rubricDescriptors = pgTable(
  "rubric_descriptors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    dimensionId: uuid("dimension_id")
      .notNull()
      .references(() => rubricDimensions.id, { onDelete: "cascade" }),
    levelId: uuid("level_id")
      .notNull()
      .references(() => rubricLevels.id, { onDelete: "cascade" }),
    descriptor: text("descriptor").notNull(),
  },
  (t) => [
    uniqueIndex("rubric_descriptors_cell_idx").on(t.dimensionId, t.levelId),
    index("rubric_descriptors_org_idx").on(t.organisationId),
  ],
);
