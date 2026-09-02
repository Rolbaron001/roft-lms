import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { cohorts } from "./delivery";
import { assessments } from "./assessment";

/**
 * The procedures that happen around a programme rather than in it.
 *
 * Appeals, grievances, discipline, support needs, feedback and recognition.
 * They share nothing structurally, and it would be tidier to scatter them next
 * to whatever they touch. They are together because of who reads them: these
 * are the records that get produced when something has gone wrong, and the
 * question asked of them is always the same one - what did the provider do,
 * and when, and can it show that.
 *
 * Each is small on its own. What they have in common is that the client
 * currently keeps them in a spreadsheet per cohort, an email thread, or
 * nowhere, and a procedure whose evidence lives in an inbox is a procedure
 * that cannot be audited.
 */

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------

export const appealGround = pgEnum("appeal_ground", [
  /** Against the result received. Goes to the internal moderator. */
  "result",
  /**
   * Against the assessor's conduct. A different animal entirely: no
   * re-marking will settle it, and the moderator is not the right person.
   */
  "assessor_conduct",
]);

export const appealStatus = pgEnum("appeal_status", [
  "lodged",
  "acknowledged",
  "under_review",
  "resolved",
  "withdrawn",
]);

export const appealOutcome = pgEnum("appeal_outcome", [
  "upheld",
  "partially_upheld",
  "dismissed",
]);

/**
 * A learner's appeal, from lodging to outcome.
 *
 * The procedure is unusually specific about time: the learner has two working
 * days from receiving the result or from the incident, and the assessor
 * acknowledges within two hours. The two-hour clock is the one that gets
 * missed, because it runs while somebody is teaching, and the only way anybody
 * finds out it was missed is if a record exists to show it.
 *
 * Recorded per cohort because that is how the client files them, and because
 * "three appeals against one assessor on one cohort" is a fact worth being
 * able to see. It is a fact that no per-learner filing will ever surface.
 */
export const appeals = pgTable(
  "appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohorts.id, { onDelete: "cascade" }),

    ground: appealGround("ground").notNull(),
    /** The assessment appealed against, where the ground is a result. */
    assessmentId: uuid("assessment_id").references(() => assessments.id, {
      onDelete: "set null",
    }),

    /**
     * The day the clock started: results received, or the incident.
     *
     * Held apart from when the appeal was lodged because the deadline is
     * counted from it, and because a learner who received a result late has a
     * defence that only exists if the two dates are separate.
     */
    triggeredOn: date("triggered_on").notNull(),
    lodgedOn: date("lodged_on").notNull(),
    lodgedAt: timestamp("lodged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Who put it in. The learner, or a member of staff on their behalf. */
    lodgedById: uuid("lodged_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** What the learner says. Required: an appeal with no grounds is a mood. */
    statement: text("statement").notNull(),

    /**
     * Why an out-of-time appeal was accepted anyway.
     *
     * The platform does not refuse a late appeal. Refusing would push it back
     * into an inbox and the platform would stop being the record, which is
     * worse than a late appeal. What it refuses is accepting one silently:
     * somebody has to say why, and the reason is part of the file.
     */
    lateAcceptanceReason: text("late_acceptance_reason"),

    status: appealStatus("status").notNull().default("lodged"),

    /** The two-hour clock. Who stopped it, and when. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedById: uuid("acknowledged_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /** The meeting with the learner. */
    metLearnerOn: date("met_learner_on"),

    /**
     * The internal moderator consulted on a result appeal.
     *
     * Recorded rather than assumed, because it is the step the procedure turns
     * on and the one an external verifier asks about. A result appeal cannot
     * be resolved without it.
     */
    moderatorId: uuid("moderator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    moderatorConsultedAt: timestamp("moderator_consulted_at", {
      withTimezone: true,
    }),

    outcome: appealOutcome("outcome"),
    /** Required to resolve. An unexplained outcome is not a resolution. */
    outcomeReason: text("outcome_reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /**
     * When the learner was actually told.
     *
     * Separate from resolution, because a decision the learner has not been
     * given is not feedback, and the gap between the two is the complaint that
     * follows.
     */
    learnerInformedAt: timestamp("learner_informed_at", { withTimezone: true }),

    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnReason: text("withdrawn_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appeals_cohort_idx").on(t.organisationId, t.cohortId, t.status),
    index("appeals_learner_idx").on(t.organisationId, t.learnerId),
    index("appeals_open_idx").on(t.organisationId, t.status, t.lodgedAt),
  ],
);

/**
 * What happened on an appeal, in order.
 *
 * The appeal row holds the state; this holds the account. Kept apart because
 * the procedure has a discussion between coordinator and assessor, a meeting
 * with the learner and a consultation with the moderator, and flattening those
 * into columns would either lose the ones that happen twice or invent columns
 * for steps that mostly do not happen.
 */
export const appealNotes = pgTable(
  "appeal_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    appealId: uuid("appeal_id")
      .notNull()
      .references(() => appeals.id, { onDelete: "cascade" }),

    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    note: text("note").notNull(),

    /**
     * Whether the learner may read it.
     *
     * Off by default. A coordinator and assessor discussing an appeal need to
     * be able to write plainly, and a note the learner can see is a different
     * kind of writing. What the learner is entitled to is the outcome and the
     * reason for it, which are on the appeal itself.
     */
    visibleToLearner: boolean("visible_to_learner").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("appeal_notes_appeal_idx").on(t.organisationId, t.appealId)],
);
