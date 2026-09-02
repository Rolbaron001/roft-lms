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

// ---------------------------------------------------------------------------
// Learner support and special needs
// ---------------------------------------------------------------------------

export const supportCategory = pgEnum("support_category", [
  /** Mobility, and anything about physical access to the room or the work. */
  "mobility",
  /** Psychological, including anxiety, and anything with a diagnosis behind it. */
  "psychological",
  /** Economic: transport, materials, hunger. Not a disability, still a barrier. */
  "economic",
  /** Sensory: sight and hearing. */
  "sensory",
  "other",
]);

export const supportStatus = pgEnum("support_status", ["active", "closed"]);

/**
 * A learner's support need, and what is being done about it.
 *
 * The most sensitive table in the platform. Health and disability are special
 * personal information under POPIA, and the ordinary justification for holding
 * learner data does not stretch to them: they are held because the provider
 * cannot make a reasonable accommodation without knowing what to accommodate,
 * and for no other reason.
 *
 * So the record is split in two, which is the whole design.
 *
 * `need` is the sensitive half - the diagnosis, the symptoms, the financial
 * circumstances. Restricted, and never shown to somebody who only holds the
 * permission to act on it.
 *
 * `accommodation` is what the facilitator or assessor actually does: seat them
 * near the door, allow breaks, provide printed materials, extend time. The
 * procedure requires the coordinator to inform them; it does not require, and
 * POPIA does not invite, telling them why. Somebody who needs to know that a
 * learner takes breaks does not need to know the diagnosis that earns them,
 * and the split is what lets the platform honour both at once.
 */
export const supportNeeds = pgTable(
  "support_needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    category: supportCategory("category").notNull(),

    /**
     * The sensitive half.
     *
     * Nullable because a need can be recorded and acted on without the detail
     * ever being written down, and often should be. An accommodation with no
     * diagnosis attached is a smaller liability and works just as well.
     */
    need: text("need"),

    /** What the people around the learner do. Shared with them. */
    accommodation: text("accommodation").notNull(),

    /**
     * Whether the learner agreed to this being recorded.
     *
     * Held per record rather than per learner, because a learner may be
     * willing to disclose a mobility need and not a psychological one, and
     * treating one consent as covering both is the failure POPIA is about.
     */
    learnerConsented: boolean("learner_consented").notNull().default(false),
    consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),

    /** Whether the employer was brought in, as the procedure asks. */
    employerInformed: boolean("employer_informed").notNull().default(false),
    employerRepresentative: text("employer_representative"),

    status: supportStatus("status").notNull().default("active"),
    /** When it should next be looked at. The procedure asks for review. */
    reviewDue: date("review_due"),

    raisedById: uuid("raised_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("support_needs_learner_idx").on(
      t.organisationId,
      t.learnerId,
      t.status,
    ),
    index("support_needs_review_idx").on(t.organisationId, t.reviewDue),
  ],
);

/**
 * A check-in on a support plan.
 *
 * The procedure asks for support to be monitored rather than arranged and
 * forgotten, and "we reviewed it regularly" is a claim that needs dates behind
 * it. Notes here follow the same split as the need: this is about whether the
 * accommodation is working, not about the learner's health.
 */
export const supportReviews = pgTable(
  "support_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    supportNeedId: uuid("support_need_id")
      .notNull()
      .references(() => supportNeeds.id, { onDelete: "cascade" }),

    reviewedOn: date("reviewed_on").notNull(),
    reviewedById: uuid("reviewed_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    /** Whether it is doing what it was meant to. */
    working: boolean("working").notNull(),
    note: text("note").notNull(),
    /** What changed as a result, if anything. */
    adjustment: text("adjustment"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("support_reviews_need_idx").on(t.organisationId, t.supportNeedId),
  ],
);

// ---------------------------------------------------------------------------
// A missed summative, and the one additional date
// ---------------------------------------------------------------------------

export const missedAssessmentOutcome = pgEnum("missed_assessment_outcome", [
  /** An additional date was set. The procedure allows exactly one. */
  "additional_date_set",
  /** The additional date was also missed, on medical grounds: goes oral. */
  "oral_authorised",
  /** Sat on the additional date. */
  "sat",
  /** Neither date used and no medical ground. */
  "forfeited",
]);

/**
 * A summative assessment date a learner did not turn up for.
 *
 * The procedure gives one additional date, and one only. That number is the
 * point of this table: without a record of the first miss there is nothing
 * stopping a third and fourth date being arranged one conversation at a time,
 * which is the failure an external verifier finds by counting sittings.
 *
 * Where the additional date is missed for a medical reason, the procedure
 * routes to an oral assessment with an observer from the employer. That
 * machinery already exists for a third attempt after two not-yet-competent
 * results; this records the authorisation that opens it by a different route.
 */
export const missedAssessments = pgTable(
  "missed_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),

    /** The date they did not attend. */
    missedOn: date("missed_on").notNull(),
    missedReason: text("missed_reason"),

    /** The one additional date the procedure allows. */
    additionalDate: date("additional_date"),
    additionalDateSetById: uuid("additional_date_set_by_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),

    outcome: missedAssessmentOutcome("outcome")
      .notNull()
      .default("additional_date_set"),

    /**
     * Why the additional date was missed, where it was.
     *
     * A medical ground is what opens the oral route, so it is recorded as its
     * own fact rather than inferred from prose somebody wrote in a hurry.
     */
    secondMissMedical: boolean("second_miss_medical").notNull().default(false),
    secondMissNote: text("second_miss_note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("missed_assessments_learner_idx").on(
      t.organisationId,
      t.learnerId,
      t.assessmentId,
    ),
  ],
);
