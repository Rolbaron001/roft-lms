import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organisations, users } from "./tenancy";
import { cohorts } from "./delivery";
import { assessments } from "./assessment";
import { curriculumModules, qualifications } from "./curriculum";

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

// ---------------------------------------------------------------------------
// Programme feedback
// ---------------------------------------------------------------------------

/**
 * The questions asked after a summative.
 *
 * Held as data rather than as columns, and versioned, because a provider will
 * change what it asks and a change must not rewrite the meaning of answers
 * already given. A response points at the version it answered, so a report can
 * say which question a 4 out of 5 was a 4 to.
 *
 * The default set shipped with the platform is a reasonable one and is not the
 * client's own. Theirs lives in a Google Form that was not among the documents
 * handed over; when it arrives it replaces this, and nothing in the code has to
 * change to let it.
 */
export const feedbackQuestionnaires = pgTable(
  "feedback_questionnaires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /**
     * The questions, in order.
     *
     * `key` is what a response is filed under and must never be reused for a
     * different question - that is the one way a version can lie about
     * historical answers.
     */
    questions: jsonb("questions")
      .$type<
        {
          key: string;
          prompt: string;
          kind: "rating" | "text";
          required: boolean;
        }[]
      >()
      .notNull(),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feedback_questionnaires_org_idx").on(t.organisationId, t.active),
  ],
);

/**
 * An invitation to a cohort to give feedback on what they have just sat.
 *
 * The procedure sends the form the day after a summative and gives learners 48
 * hours. Both of those are here as facts rather than as habits: the platform
 * can say which cohorts were never asked, and which learners have not
 * answered, and neither question can be answered from a folder of returned
 * forms.
 */
export const feedbackRequests = pgTable(
  "feedback_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohorts.id, { onDelete: "cascade" }),
    /** The summative it follows. Null for feedback on the programme overall. */
    assessmentId: uuid("assessment_id").references(() => assessments.id, {
      onDelete: "set null",
    }),
    questionnaireId: uuid("questionnaire_id")
      .notNull()
      .references(() => feedbackQuestionnaires.id, { onDelete: "restrict" }),

    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    sentById: uuid("sent_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** 48 hours on, by the procedure. Held rather than computed on read. */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),

    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("feedback_requests_cohort_idx").on(t.organisationId, t.cohortId),
    uniqueIndex("feedback_requests_once_idx").on(
      t.organisationId,
      t.cohortId,
      t.assessmentId,
    ),
  ],
);

/**
 * One learner's answers.
 *
 * The learner is recorded, because the facilitator has to know who still owes a
 * form in order to chase them, and a response nobody can attribute cannot be
 * chased. What the platform then does with that is the part worth stating
 * plainly: the consolidated view never shows names, because feedback on a
 * facilitator is only honest if the learner believes it will not be read back
 * to them by name.
 *
 * That is a display decision, not anonymity. The link exists in the table and
 * somebody with database access can follow it. Saying otherwise to a learner
 * would be a lie, and the wording shown to them says only that responses are
 * reported together - which is true.
 */
export const feedbackResponses = pgTable(
  "feedback_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => feedbackRequests.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Keyed by the question key, against the version that was asked. */
    answers: jsonb("answers")
      .$type<Record<string, string | number>>()
      .notNull(),

    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Whether it arrived after the 48 hours.
     *
     * Recorded, never refused. Feedback is voluntary and is worth having
     * whenever it turns up; what the deadline is for is knowing whether the
     * provider asked in time, not punishing a learner for answering late.
     */
    late: boolean("late").notNull().default(false),
  },
  (t) => [
    uniqueIndex("feedback_responses_once_idx").on(
      t.organisationId,
      t.requestId,
      t.learnerId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Competency badges
// ---------------------------------------------------------------------------

export const badgeKind = pgEnum("badge_kind", [
  /** Earned by completing one curriculum module. */
  "curriculum_module",
  /** Earned by completing the whole qualification. */
  "qualification",
]);

/**
 * A badge a tenant defines and its learners can earn.
 *
 * Not decoration. Formal certification under the OQSF arrives months after the
 * work is finished - the external assessment has to be sat, moderated and
 * processed by the assessment quality partner - and the client has measurably
 * lost learners in that gap. A badge is the recognition that arrives on the day
 * the module is finished, which is the day it means something.
 *
 * What it deliberately is not is a qualification. A badge says this provider
 * recorded this person as competent in this module on this date. It carries no
 * SAQA identifier, no credits and no awarding-body claim, because inventing one
 * would be a misrepresentation the regulator would be right to object to. The
 * verification page says so in as many words.
 */
export const badges = pgTable(
  "badges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    kind: badgeKind("kind").notNull(),
    /** What earns it. Exactly one of these is set, per the kind. */
    curriculumModuleId: uuid("curriculum_module_id").references(
      () => curriculumModules.id,
      { onDelete: "cascade" },
    ),
    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "cascade" },
    ),

    name: text("name").notNull(),
    description: text("description"),
    /**
     * An emoji or short glyph. Deliberately not an image upload.
     *
     * A badge nobody has to design is a badge that actually gets created, and
     * the client has no designer. An image store for something two characters
     * wide would be cost with no reader.
     */
    glyph: text("glyph").notNull().default("★"),

    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("badges_org_idx").on(t.organisationId, t.active),
    uniqueIndex("badges_module_once_idx").on(
      t.organisationId,
      t.curriculumModuleId,
    ),
  ],
);

/**
 * A badge somebody has earned.
 *
 * Awarded from the same reading of the criterion ledger that decides
 * readiness, never typed in by hand, so a badge cannot claim something the
 * assessment record does not. It carries the date the module was completed
 * rather than the date the row happened to be written, because a learner who
 * finished in March and had their badge created by a backfill in July finished
 * in March.
 */
export const badgeAwards = pgTable(
  "badge_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => badges.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** The day the work was finished, not the day this row was written. */
    earnedOn: date("earned_on").notNull(),
    /**
     * A short public reference, so a learner can show somebody the badge
     * without the platform having to expose a database identifier.
     */
    reference: text("reference").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("badge_awards_once_idx").on(
      t.organisationId,
      t.badgeId,
      t.learnerId,
    ),
    uniqueIndex("badge_awards_reference_idx").on(t.reference),
    index("badge_awards_learner_idx").on(t.organisationId, t.learnerId),
  ],
);

// ---------------------------------------------------------------------------
// Learner discipline
// ---------------------------------------------------------------------------

export const offenceGrade = pgEnum("offence_grade", [
  /** Late arrival, minor disruption, a small assignment missed. */
  "minor",
  /** Repeated minor, unauthorised absence, cheating, disrespect, damage. */
  "serious",
  /** Theft, violence, harassment, substances, disrepute, repeated serious. */
  "gross",
]);

export const disciplinaryStage = pgEnum("disciplinary_stage", [
  /** A documented conversation. Explicitly not a warning. */
  "informal_counselling",
  "verbal_warning",
  "written_warning",
  "final_written_warning",
  "hearing",
  "closed",
]);

export const disciplinarySanction = pgEnum("disciplinary_sanction", [
  "no_action",
  "counselled",
  "verbal_warning",
  "written_warning",
  "final_written_warning",
  "terminated",
  "expelled",
]);

/**
 * A disciplinary matter, from the first note to the sanction.
 *
 * The procedure is long and mostly about people talking to each other, which a
 * platform should not try to run. What it holds is the part that has to be
 * provable afterwards: what the learner was accused of, what grade it was
 * treated as, what warnings were live at the time, whether they were given
 * notice of a hearing and how much, and what was decided.
 *
 * That list is not arbitrary. It is what a CCMA referral or a sponsor's
 * complaint asks for, and it is exactly what a folder of emails cannot produce
 * in the order it happened.
 */
export const disciplinaryCases = pgTable(
  "disciplinary_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id").references(() => cohorts.id, {
      onDelete: "set null",
    }),

    grade: offenceGrade("grade").notNull(),
    /** What is alleged. Required: a case with no allegation cannot be answered. */
    allegation: text("allegation").notNull(),
    occurredOn: date("occurred_on").notNull(),

    stage: disciplinaryStage("stage").notNull().default("informal_counselling"),

    raisedById: uuid("raised_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    raisedAt: timestamp("raised_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Whether the sponsor was told, which the procedure requires before a hearing. */
    sponsorNotifiedAt: timestamp("sponsor_notified_at", { withTimezone: true }),
    sponsorRepresentative: text("sponsor_representative"),

    sanction: disciplinarySanction("sanction"),
    /** Required to close. An unexplained sanction is indefensible. */
    outcomeReason: text("outcome_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedById: uuid("closed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /**
     * When the learner was given the outcome in writing.
     *
     * The right to appeal runs from this, not from the decision, so it is held
     * separately. A learner who was never told has not had five working days.
     */
    outcomeGivenAt: timestamp("outcome_given_at", { withTimezone: true }),
    appealBy: date("appeal_by"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("disciplinary_cases_learner_idx").on(t.organisationId, t.learnerId),
    index("disciplinary_cases_open_idx").on(t.organisationId, t.stage),
  ],
);

export const warningKind = pgEnum("warning_kind", [
  "verbal",
  "written",
  "final_written",
]);

/**
 * A warning, and the date it stops counting.
 *
 * The validity period is the whole reason this is a table rather than a column
 * on the case. Escalation depends on what is live now, and a warning issued
 * two years ago is not live - treating it as though it were is the single most
 * common way a disciplinary decision is overturned.
 */
export const disciplinaryWarnings = pgTable(
  "disciplinary_warnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => disciplinaryCases.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    kind: warningKind("kind").notNull(),
    issuedOn: date("issued_on").notNull(),
    /** After this it no longer counts towards escalation. */
    validUntil: date("valid_until").notNull(),

    /** The rule broken, the standard expected, and what happens if it recurs. */
    terms: text("terms").notNull(),

    issuedById: uuid("issued_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** The learner's signature of receipt, which the procedure asks for. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("disciplinary_warnings_learner_idx").on(
      t.organisationId,
      t.learnerId,
      t.validUntil,
    ),
  ],
);

/**
 * A formal hearing.
 *
 * The notice period is the one thing here the platform genuinely enforces. The
 * procedure says at least 48 hours, and a hearing convened at shorter notice is
 * the procedural defect that costs a provider the case regardless of what the
 * learner did. It is checked against the clock rather than trusted to whoever
 * is arranging it under pressure.
 */
export const disciplinaryHearings = pgTable(
  "disciplinary_hearings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => disciplinaryCases.id, { onDelete: "cascade" }),

    noticeGivenAt: timestamp("notice_given_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),

    venue: text("venue"),
    /** Runs where the lectures do, if it is not in a room. */
    meetingUrl: text("meeting_url"),

    /** The specific allegations put, which the notice must state. */
    allegations: text("allegations").notNull(),
    /** The sanctions the learner is told are possible. */
    sanctionsAdvised: text("sanctions_advised").notNull(),
    /**
     * That the learner was told their rights: to be assisted by a fellow
     * learner, to present a case, to call and question witnesses.
     *
     * A single flag rather than four, because they are advised in one sentence
     * of one letter and recording them apart would suggest a choice nobody has.
     */
    rightsAdvised: boolean("rights_advised").notNull().default(false),

    heldAt: timestamp("held_at", { withTimezone: true }),
    chairId: uuid("chair_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assistedBy: text("assisted_by"),
    findings: text("findings"),

    postponedReason: text("postponed_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("disciplinary_hearings_case_idx").on(t.organisationId, t.caseId)],
);

// ---------------------------------------------------------------------------
// Grievances
// ---------------------------------------------------------------------------

export const grievanceStatus = pgEnum("grievance_status", [
  "lodged",
  "acknowledged",
  "under_investigation",
  "decided",
  "appealed",
  "closed",
]);

/**
 * A learner's grievance, which runs the opposite way to a disciplinary case.
 *
 * Kept apart from appeals deliberately. An appeal is about a result or an
 * assessor's conduct in assessing; a grievance is about treatment, conditions,
 * or anything else affecting the learner's experience, and it goes to a
 * different person on a different clock. Filing them together would put a
 * complaint about a facilitator's behaviour in front of the moderator, who has
 * no standing in it.
 *
 * The procedure promises confidentiality and freedom from victimisation. The
 * platform cannot deliver either, but it can make the dates provable, which is
 * what a learner who was victimised will need.
 */
export const grievances = pgTable(
  "grievances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id").references(() => cohorts.id, {
      onDelete: "set null",
    }),

    /** Whether informal resolution was tried, as the procedure encourages. */
    informalAttempted: boolean("informal_attempted").notNull().default(false),

    nature: text("nature").notNull(),
    individualsInvolved: text("individuals_involved"),
    occurredOn: date("occurred_on"),
    desiredOutcome: text("desired_outcome"),

    lodgedOn: date("lodged_on").notNull(),
    lodgedAt: timestamp("lodged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    status: grievanceStatus("status").notNull().default("lodged"),

    /** Two working days, by the procedure. */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgeBy: date("acknowledge_by").notNull(),

    /**
     * The impartial person investigating.
     *
     * Named rather than assumed, and the platform refuses to let it be somebody
     * the grievance is about - which is the failure the word "impartial" is
     * there to prevent and the one that happens when a small provider is short
     * of people.
     */
    investigatorId: uuid("investigator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    meetingHeldOn: date("meeting_held_on"),

    decidedOn: date("decided_on"),
    /** Seven to ten working days from the meeting, by the procedure. */
    decisionDueBy: date("decision_due_by"),
    decision: text("decision"),
    decisionGivenAt: timestamp("decision_given_at", { withTimezone: true }),

    appealLodgedOn: date("appeal_lodged_on"),
    appealOfficerId: uuid("appeal_officer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    appealDecision: text("appeal_decision"),
    appealDecidedOn: date("appeal_decided_on"),

    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("grievances_learner_idx").on(t.organisationId, t.learnerId),
    index("grievances_open_idx").on(t.organisationId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Recognition of Prior Learning, and Credit Accumulation and Transfer
// ---------------------------------------------------------------------------

export const rplStatus = pgEnum("rpl_status", [
  "applied",
  /** The advisory session has happened: the candidate knows what is required. */
  "advised",
  "building_portfolio",
  "submitted",
  "judged",
  "moderated",
  "closed",
]);

export const rplOutcome = pgEnum("rpl_outcome", [
  "granted",
  /** Some modules recognised, the rest to be done as ordinary learning. */
  "partial",
  "refused",
  "withdrawn",
]);

/**
 * An application to have prior learning recognised.
 *
 * RPL is the highest-risk route in the whole framework and the one an external
 * verifier looks at first, because it is the only way to hold a qualification
 * without having been taught. The procedure that protects it is not the
 * judgement itself but the two things either side of it: an advisory session
 * where somebody explains to the candidate what evidence is actually needed,
 * and independent moderation of every judgement rather than a sample.
 *
 * Both of those are enforced here. A candidate cannot go to judgement without
 * a recorded advisory session, and no judgement grants an exemption until a
 * moderator has confirmed it.
 */
export const rplApplications = pgTable(
  "rpl_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    qualificationId: uuid("qualification_id")
      .notNull()
      .references(() => qualifications.id, { onDelete: "cascade" }),

    appliedOn: date("applied_on").notNull(),

    /**
     * The advisory session, and who gave it.
     *
     * The step candidates are failed by when it is skipped: somebody assembles
     * a folder of certificates nobody told them were the wrong kind of
     * evidence, and is judged not yet competent on the strength of it.
     */
    advisorId: uuid("advisor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    advisedOn: date("advised_on"),
    adviceGiven: text("advice_given"),

    status: rplStatus("status").notNull().default("applied"),
    outcome: rplOutcome("outcome"),
    outcomeReason: text("outcome_reason"),

    submittedOn: date("submitted_on"),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rpl_applications_learner_idx").on(t.organisationId, t.learnerId),
    index("rpl_applications_open_idx").on(t.organisationId, t.status),
  ],
);

/**
 * One assessor's judgement on one module of an RPL application.
 *
 * Per module rather than per application, because a candidate with fifteen
 * years in the job will usually have plenty of evidence for some modules and
 * none for others, and "partially granted" is the ordinary outcome rather than
 * the exception.
 *
 * Every judgement is moderated. Not a sample: the cohort-size sampling rule
 * that governs ordinary assessment exists because ordinary assessment has a
 * paper trail of taught sessions behind it. RPL has none, which is exactly why
 * the whole of it is looked at twice.
 */
export const rplJudgements = pgTable(
  "rpl_judgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => rplApplications.id, { onDelete: "cascade" }),
    curriculumModuleId: uuid("curriculum_module_id")
      .notNull()
      .references(() => curriculumModules.id, { onDelete: "cascade" }),

    competent: boolean("competent").notNull(),
    /** What the evidence was and why it satisfies the module. Required. */
    rationale: text("rationale").notNull(),

    assessorId: uuid("assessor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    judgedOn: date("judged_on").notNull(),

    moderatorId: uuid("moderator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatorAgreed: boolean("moderator_agreed"),
    moderatorComment: text("moderator_comment"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rpl_judgements_once_idx").on(
      t.organisationId,
      t.applicationId,
      t.curriculumModuleId,
    ),
  ],
);

/**
 * Credit carried in from a qualification the learner already holds.
 *
 * Different from RPL in the thing that matters: the learning was already
 * assessed and certificated by somebody else, so what is being judged is
 * whether that qualification's outcomes cover this module's, not whether the
 * candidate can do the work. The evidence is a certificate rather than a
 * portfolio, and the person who signs it off is checking a mapping.
 */
export const creditTransfers = pgTable(
  "credit_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    curriculumModuleId: uuid("curriculum_module_id")
      .notNull()
      .references(() => curriculumModules.id, { onDelete: "cascade" }),

    /** What they already hold. Free text: it was awarded elsewhere. */
    sourceQualification: text("source_qualification").notNull(),
    sourceProvider: text("source_provider"),
    sourceSaqaId: text("source_saqa_id"),
    sourceCredits: integer("source_credits"),
    awardedOn: date("awarded_on"),

    /**
     * How the source outcomes cover this module's. Required.
     *
     * The whole of a credit transfer decision is this paragraph, and a transfer
     * recorded without it is a claim nobody can check - which is what an
     * external verifier is looking for.
     */
    mapping: text("mapping").notNull(),

    approvedById: uuid("approved_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedOn: date("approved_on").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("credit_transfers_once_idx").on(
      t.organisationId,
      t.learnerId,
      t.curriculumModuleId,
    ),
  ],
);

export const exemptionSource = pgEnum("exemption_source", ["rpl", "cat"]);

/**
 * A module the learner does not have to do, and why.
 *
 * One table for both routes, because what follows from an exemption is
 * identical whichever produced it: the module counts towards the qualification
 * and no assessment will ever be submitted for it.
 *
 * It exists as its own record rather than as a flag on progress because of
 * item 8.3 - an RPL candidate must not read as a learner who skipped work.
 * Readiness counts an exempt module as met and says which ones were exempt and
 * on what basis, so a monitoring visit sees recognition where recognition
 * happened rather than a gap somebody has to explain.
 */
export const moduleExemptions = pgTable(
  "module_exemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    curriculumModuleId: uuid("curriculum_module_id")
      .notNull()
      .references(() => curriculumModules.id, { onDelete: "cascade" }),

    source: exemptionSource("source").notNull(),
    /** Whichever record granted it. Exactly one is set. */
    rplJudgementId: uuid("rpl_judgement_id").references(
      () => rplJudgements.id,
      { onDelete: "cascade" },
    ),
    creditTransferId: uuid("credit_transfer_id").references(
      () => creditTransfers.id,
      { onDelete: "cascade" },
    ),

    grantedOn: date("granted_on").notNull(),
    grantedById: uuid("granted_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("module_exemptions_once_idx").on(
      t.organisationId,
      t.learnerId,
      t.curriculumModuleId,
    ),
    index("module_exemptions_learner_idx").on(t.organisationId, t.learnerId),
  ],
);

// ---------------------------------------------------------------------------
// EISA sittings
// ---------------------------------------------------------------------------

/**
 * A dated external assessment window, and when registration for it closes.
 *
 * The assessment quality partner sets these, typically three a year, with
 * registration closing about three months ahead. That gap is the whole reason
 * this is in the platform: a cohort finishing in November is registered for a
 * sitting whose deadline passed in August, and nobody notices until the
 * deadline has gone because the dates live in an email from the AQP.
 *
 * Held per tenant rather than per qualification by default, because a small
 * provider runs one AQP's calendar; where a qualification has its own the
 * qualification is named and it wins.
 */
export const eisaSittings = pgTable(
  "eisa_sittings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Null means it applies to every qualification this tenant offers. */
    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "cascade" },
    ),

    name: text("name").notNull(),
    sittingDate: date("sitting_date").notNull(),
    /** The date after which nobody can be entered for this sitting. */
    registrationCloses: date("registration_closes").notNull(),

    /** Who runs it: the assessment quality partner named on the letter. */
    assessmentQualityPartner: text("assessment_quality_partner"),
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("eisa_sittings_dates_idx").on(
      t.organisationId,
      t.registrationCloses,
    ),
  ],
);

// ---------------------------------------------------------------------------
// The general document library
// ---------------------------------------------------------------------------

export const libraryCategory = pgEnum("library_category", [
  /** Policies and procedures: the SOPs, the code of conduct, the assessment policy. */
  "policy",
  /** Accreditation letters, SETA correspondence, QCTO decisions. */
  "accreditation",
  /** Contracts: employers, sponsors, facilitators, suppliers. */
  "contract",
  /** Statutory: PAIA manual, POPIA notices, B-BBEE certificates, tax clearance. */
  "statutory",
  /** Insurance, leases, licences. */
  "operational",
  "other",
]);

export const libraryStatus = pgEnum("library_status", [
  "current",
  /** Superseded by a later version but kept, because it governed at the time. */
  "superseded",
  /** Past its retention date and moved out of the way, never deleted. */
  "archived",
]);

/**
 * Business documents that belong to the provider rather than to a learner.
 *
 * The gap that stops the platform being the record. It already holds documents
 * attached to a learner, an enrolment or a qualification; the client's Records
 * Management procedure also covers policies, accreditation letters, contracts
 * and the PAIA manual, and there was nowhere for those to live. A record system
 * missing the accreditation letter is not the system of record.
 *
 * Versioned by supersession rather than by overwriting. The policy that
 * governed in March is the one an audit of March asks about, and a library that
 * only ever holds the current version cannot answer that.
 */
export const libraryDocuments = pgTable(
  "library_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    category: libraryCategory("category").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** The provider's own reference, where they have one. */
    reference: text("reference"),
    version: text("version"),

    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** SHA-256 of the bytes, so a silent corruption is detectable. */
    contentHash: text("content_hash").notNull(),

    /** When it took effect, and when it stops being current. */
    effectiveFrom: date("effective_from"),
    expiresOn: date("expires_on"),

    /**
     * The document this one replaces.
     *
     * A chain rather than a version number, so "what was in force on this
     * date" is answerable by walking it, and so superseding is one act rather
     * than remembering to change a flag somewhere else.
     */
    supersedesId: uuid("supersedes_id"),

    status: libraryStatus("status").notNull().default("current"),

    /**
     * Whether anybody signed in may read it.
     *
     * A code of conduct is meant to be read by learners; a facilitator's
     * contract is not. Off by default, because the safe direction for a
     * document nobody has thought about is not visible.
     */
    visibleToAll: boolean("visible_to_all").notNull().default(false),

    uploadedById: uuid("uploaded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("library_documents_category_idx").on(
      t.organisationId,
      t.category,
      t.status,
    ),
    index("library_documents_expiry_idx").on(t.organisationId, t.expiresOn),
  ],
);

// ---------------------------------------------------------------------------
// Retention and controlled deletion
// ---------------------------------------------------------------------------

export const retentionSubject = pgEnum("retention_subject", [
  "learner_documents",
  "assessment_evidence",
  "library_document",
]);

export const disposalStatus = pgEnum("disposal_status", [
  /** Past its retention date and waiting for somebody to decide. */
  "due",
  /** Moved out of the working view, still held. */
  "archived",
  /** Approved for destruction by a named person, and destroyed. */
  "destroyed",
  /** Deliberately kept beyond retention, with a reason. */
  "retained",
]);

/**
 * A decision about a record that has reached the end of its retention period.
 *
 * The client's procedure says "archive learner documentation within one month
 * after certification". The platform holds the certification date, so it can
 * say what is due; what it must not do is act on it. Deletion of a record that
 * an external verifier may still ask for is not something any schedule should
 * perform unattended, and a record that quietly disappeared is worse than one
 * kept too long.
 *
 * So archiving is automatic and destruction is never. Every disposal is a row
 * with a person's name on it, and "retained" is a first-class outcome rather
 * than an omission - a provider under investigation keeps everything, and the
 * reason for that belongs in the file.
 */
export const disposalDecisions = pgTable(
  "disposal_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    subject: retentionSubject("subject").notNull(),
    /** Whichever record this is about. Exactly one is set. */
    learnerId: uuid("learner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    libraryDocumentId: uuid("library_document_id").references(
      () => libraryDocuments.id,
      { onDelete: "cascade" },
    ),

    /** When the retention period elapsed. Derived, then recorded. */
    dueOn: date("due_on").notNull(),

    status: disposalStatus("status").notNull().default("due"),
    /** Required for anything but archiving. */
    reason: text("reason"),

    decidedById: uuid("decided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("disposal_decisions_due_idx").on(
      t.organisationId,
      t.status,
      t.dueOn,
    ),
  ],
);

// ---------------------------------------------------------------------------
// AI extensions
// ---------------------------------------------------------------------------

/**
 * There is deliberately nothing tenant-wide about the AI extension.
 *
 * There was, briefly: a list of folders on the server that an import was
 * allowed to read. That existed because the first design had somebody type a
 * path and the server read its own disk, which made every user's reach the
 * service account's reach - so the folders anybody could name had to be
 * registered by an administrator to stop the platform being pointed at its own
 * configuration.
 *
 * Replacing the path with a folder picker removed the problem rather than
 * managing it. The browser hands over the files, a person can only offer what
 * they can already open, and no server path is involved at any point. Nothing
 * left to register, and nothing left to restrict.
 *
 * What remains is per person, below.
 */

/**
 * One person's own choice about model assistance.
 *
 * Per user rather than per tenant, because the extension is a tool somebody
 * uses while doing their own work, and a platform where only the administrator
 * may switch it on is a platform where only the administrator has it. A
 * facilitator building a programme has the same use for it as the person who
 * bought the subscription.
 *
 * What this does not give is a subscription per person. The provider runs on
 * the machine the platform is running on, so on a shared server everybody's
 * work goes through whichever sign-in is on that machine. Where each person
 * runs the platform themselves, each uses their own. The interface says so
 * rather than implying otherwise.
 */
export const aiUserSettings = pgTable(
  "ai_user_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** A provider name the platform knows, or null for none. */
    provider: text("provider"),
    /** Empty means the provider's own default. */
    model: text("model"),
    enabled: boolean("enabled").notNull().default(false),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ai_user_settings_user_idx").on(t.organisationId, t.userId)],
);

export const aiRunOutcome = pgEnum("ai_run_outcome", [
  "ok",
  "failed",
  "refused",
]);

/**
 * Every model call the platform makes, whether it worked or not.
 *
 * Failures are recorded as carefully as successes, because a provider that
 * keeps failing is itself a finding: usage limits reached, nobody signed in,
 * a machine that has moved. Without the failures the log says the extension is
 * never used, which is a different conclusion entirely.
 *
 * The prompt is not stored, only its hash and size. A prompt carries whatever
 * document was being read, which may be a learner's evidence, and a log is
 * read by more people than the thing it describes. The hash is enough to say
 * two runs asked the same question.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    provider: text("provider").notNull(),
    model: text("model"),
    /** What it was asked to do: "import_qualification", and so on. */
    task: text("task").notNull(),

    promptHash: text("prompt_hash").notNull(),
    promptBytes: integer("prompt_bytes").notNull(),

    outcome: aiRunOutcome("outcome").notNull(),
    durationMs: integer("duration_ms"),
    /** Zero on a subscription. Recorded so a switch to metered is visible. */
    costUsd: text("cost_usd"),
    error: text("error"),

    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_runs_org_idx").on(t.organisationId, t.createdAt)],
);

export const importJobStatus = pgEnum("import_job_status", [
  "reading",
  /** The model has proposed something and a person has not looked yet. */
  "proposed",
  "failed",
  "committed",
  "discarded",
]);

/**
 * A folder somebody pointed the extension at, and what it proposed.
 *
 * The same shape as the document capture that already exists, and for the same
 * reason: the model proposes and a person commits. Nothing here writes a
 * qualification. What it produces is a proposal that goes through the ordinary
 * authoring functions one module at a time, so every guard that protects a
 * hand-built curriculum protects this one.
 *
 * That is not caution for its own sake. A qualification is an accredited
 * structure that an external verifier reads against the source document, and a
 * curriculum nobody checked against the document it came from is precisely
 * what this platform exists to prevent - whether a person typed it or a model
 * did.
 */
export const aiImportJobs = pgTable(
  "ai_import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    /** The folder as given, and what was actually found in it. */
    sourcePath: text("source_path").notNull(),
    files: jsonb("files")
      .$type<{ name: string; bytes: number; kind: string }[]>()
      .notNull()
      .default([]),

    status: importJobStatus("status").notNull().default("reading"),

    /**
     * What the model proposed, as read.
     *
     * Stored whole and unedited so that what a person approved can be compared
     * with what was proposed. A proposal that was quietly normalised on the way
     * in cannot be audited.
     */
    proposal: jsonb("proposal"),
    problems: jsonb("problems").$type<string[]>().notNull().default([]),

    /**
     * Where each uploaded file was staged, keyed by its path in the folder.
     *
     * The commit happens in a later request and needs the bytes back. They are
     * kept afterwards rather than swept up, because what was uploaded is the
     * evidence of what was imported - a proposal that cannot be compared with
     * the folder it came from is one nobody can audit.
     */
    stagedFiles: jsonb("staged_files")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),

    /**
     * What the folder was being read into, decided when it was read.
     *
     * Held so the review screen does not have to ask again. A folder read from
     * a course is filed against that course; only a folder read from nowhere in
     * particular is building a new qualification, and only that one needs
     * somebody to say which.
     */
    target: jsonb("target")
      .$type<{
        mode: "qualification" | "material" | "course" | "programme";
        qualificationId?: string;
        courseId?: string;
        learningPathId?: string;
      }>()
      .notNull()
      .default({ mode: "qualification" }),

    /** The qualification it was committed into, once it has been. */
    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "set null" },
    ),

    /**
     * The module codes already taken from this proposal.
     *
     * A proposal is committed a module at a time, over more than one sitting if
     * whoever is checking it has other work. Without this the first commit
     * would close the job and strand the rest, which is what happened the first
     * time this was run end to end.
     */
    committedModules: jsonb("committed_modules")
      .$type<string[]>()
      .notNull()
      .default([]),

    requestedById: uuid("requested_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    committedById: uuid("committed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    committedAt: timestamp("committed_at", { withTimezone: true }),

    error: text("error"),
  },
  (t) => [index("ai_import_jobs_org_idx").on(t.organisationId, t.status)],
);
