import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { competencies, organisations, users } from "./tenancy";
import {
  assessmentCriteria,
  courses,
  curriculumModules,
  curriculumTopicElements,
  publishStatus,
  qualifications,
} from "./curriculum";
import { enrolments } from "./learning";
import { rubrics } from "./rubrics";

export const assessmentType = pgEnum("assessment_type", [
  "quiz",
  "evidence_submission",
  "practical_observation",
  "workplace_logbook",
]);

export const assessmentPurpose = pgEnum("assessment_purpose", [
  "formative",
  "summative",
]);

export const itemType = pgEnum("item_type", [
  "multiple_choice",
  "multiple_response",
  "true_false",
  "short_answer",
  /** A structured response of several paragraphs, marked against a rubric. */
  "long_answer",
  "numeric",
  "scenario",
  "file_upload",
  "observation_checklist",
]);

/**
 * Which paper an attempt draws.
 *
 * Two written papers exist for the summative — V1 and V2 — so a re-sit is a
 * different paper rather than the same one again. `fixed` gives every attempt
 * the first paper, which is what an ordinary workbook wants.
 */
export const attemptPolicy = pgEnum("attempt_policy", [
  "fixed",
  "rotate",
  "random",
]);

/** How a paper is taken. An oral paper has prompts for the assessor, not items. */
export const paperMode = pgEnum("paper_mode", ["written", "oral"]);

export const competencyOutcome = pgEnum("competency_outcome", [
  "competent",
  "not_yet_competent",
]);

export const submissionStatus = pgEnum("submission_status", [
  "draft",
  "submitted",
  "assessed",
  "moderated",
  "referred_back",
  "finalised",
]);

export const moderationOutcome = pgEnum("moderation_outcome", [
  "endorsed",
  "referred_back",
  "overridden",
]);

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "cascade",
    }),
    curriculumModuleId: uuid("curriculum_module_id").references(
      () => curriculumModules.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    instructions: text("instructions"),
    type: assessmentType("type").notNull().default("quiz"),
    purpose: assessmentPurpose("purpose").notNull().default("formative"),
    status: publishStatus("status").notNull().default("draft"),

    /** Percentage required to pass an auto-marked assessment. */
    passMark: integer("pass_mark").notNull().default(70),
    maxAttempts: integer("max_attempts"),
    timeLimitMinutes: integer("time_limit_minutes"),

    /** Which paper each attempt draws. See `assessmentPapers`. */
    attemptPolicy: attemptPolicy("attempt_policy").notNull().default("rotate"),

    /**
     * Whether a person opens the sitting for the learner.
     *
     * Almost every sitting is online and unsupervised, and the platform should
     * not imply otherwise. What it records is what it genuinely knows: when
     * the attempt started, how long it took, and — where this is set — who
     * opened it. None of that is proof of anything and none of it is shown as
     * though it were.
     */
    requiresInvigilator: boolean("requires_invigilator").notNull().default(false),

    /**
     * What a learner attests to on handing in. Frozen into each submission, so
     * a year later the record shows what was agreed rather than merely that
     * something was.
     */
    declarationText: text("declaration_text"),

    /**
     * Proportion of this assessment's decisions routed to a moderator, as a
     * fraction.
     *
     * 0.25 is this platform's default, not a figure any authority prescribes.
     * Sampling rates are set by the provider's own assessment and moderation
     * policy, and by whatever the relevant Quality Partner requires of it, so
     * a provider should set this to match their approved policy rather than
     * assume the default is compliant. An externally accredited summative
     * assessment is usually set to 1.0 so every decision is moderated.
     */
    moderationSampleRate: numeric("moderation_sample_rate", {
      precision: 4,
      scale: 3,
    })
      .notNull()
      .default("0.25"),
    /** Newly registered assessors are moderated in full regardless of the rate. */
    moderateAllForNewAssessors: boolean("moderate_all_for_new_assessors")
      .notNull()
      .default(true),

    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assessments_org_idx").on(t.organisationId),
    index("assessments_course_idx").on(t.courseId),
  ],
);

/**
 * The item bank, per step 1 of the Section 9 workflow. Questions are authored
 * against a competency and a criterion, versioned, and reviewed before use —
 * not written ad hoc at the point of assessment.
 */
export const assessmentItems = pgTable(
  "assessment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    competencyId: uuid("competency_id").references(() => competencies.id, {
      onDelete: "set null",
    }),
    criterionId: uuid("criterion_id").references(() => assessmentCriteria.id, {
      onDelete: "set null",
    }),
    /**
     * The section of a paper this item sits in.
     *
     * Null for an item written straight onto an assessment, which is what a
     * short quiz is and what every assessment authored before papers existed
     * still is. An item with a section belongs to that section's paper.
     */
    sectionId: uuid("section_id").references(() => assessmentSections.id, {
      onDelete: "cascade",
    }),

    type: itemType("type").notNull().default("multiple_choice"),
    stem: text("stem").notNull(),
    /** Answer options for a selected-response item: [{ id, text }]. */
    options: jsonb("options").$type<{ id: string; text: string }[]>(),
    /** Option ids that count as correct. Never sent to a learner's browser. */
    correctOptionIds: jsonb("correct_option_ids").$type<string[]>(),
    /** Marking guidance for a human-marked item. */
    markingGuide: text("marking_guide"),
    /**
     * The matrix an assessor marks this against, where it is marked by a
     * person. Prose guidance says what a good answer looks like; a rubric says
     * what each grade of answer looks like, which is what makes two assessors
     * agree.
     */
    rubricId: uuid("rubric_id").references(() => rubrics.id, {
      onDelete: "set null",
    }),
    points: integer("points").notNull().default(1),
    feedbackCorrect: text("feedback_correct"),
    feedbackIncorrect: text("feedback_incorrect"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    index("assessment_items_assessment_idx").on(t.assessmentId),
    index("assessment_items_org_idx").on(t.organisationId),
    index("assessment_items_criterion_idx").on(t.criterionId),
    index("assessment_items_section_idx").on(t.sectionId),
  ],
);

/** One learner attempt at one assessment. */
export const assessmentSubmissions = pgTable(
  "assessment_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id").references(() => enrolments.id, {
      onDelete: "set null",
    }),

    attemptNumber: integer("attempt_number").notNull().default(1),
    status: submissionStatus("status").notNull().default("draft"),

    /** Which paper this attempt drew. Null for a flat quiz with no papers. */
    paperId: uuid("paper_id").references(() => assessmentPapers.id, {
      onDelete: "set null",
    }),

    /**
     * The paper exactly as it was presented: stems, options, marks, sections.
     *
     * An author correcting a question next month must not change the paper a
     * learner already sat. A moderator opening this in six months sees what
     * the learner saw, not what the assessment has since become.
     */
    frozenPaper: jsonb("frozen_paper"),

    /** When the learner started, which is what the clock runs from. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    /** Recorded only where a person actually opened the sitting. */
    invigilatorId: uuid("invigilator_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /**
     * The declaration of authenticity, and the moment it was accepted.
     *
     * The wording is copied in rather than referenced, because the assessment
     * wording may change later. Submission is refused without this.
     */
    declarationText: text("declaration_text"),
    declarationAcceptedAt: timestamp("declaration_accepted_at", {
      withTimezone: true,
    }),
    /**
     * Set when the clock ran out rather than the learner handing in.
     *
     * The work is kept — a dropped connection is not cheating — but nobody
     * attested to it, and the record has to say which of the two happened
     * rather than leaving an assessor to infer it from a missing timestamp.
     */
    closedOnTime: boolean("closed_on_time").notNull().default(false),
    /** Learner responses keyed by item id. Retained in full for audit. */
    responses: jsonb("responses").$type<Record<string, unknown>>(),
    autoScore: numeric("auto_score", { precision: 6, scale: 2 }),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }),

    // Provenance captured at submission, so evidence can be tied to a person,
    // a place and a moment during a regulatory audit.
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedIp: text("submitted_ip"),
    submittedUserAgent: text("submitted_user_agent"),
    gpsLatitude: numeric("gps_latitude", { precision: 9, scale: 6 }),
    gpsLongitude: numeric("gps_longitude", { precision: 9, scale: 6 }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("assessment_submissions_attempt_idx").on(
      t.assessmentId,
      t.userId,
      t.attemptNumber,
    ),
    index("assessment_submissions_org_idx").on(t.organisationId),
    index("assessment_submissions_user_idx").on(t.userId),
  ],
);

/**
 * An uploaded piece of evidence. The SHA-256 hash is written once at upload;
 * if the stored file is ever altered its hash stops matching and the record is
 * flagged, which is what makes the portfolio defensible at audit.
 */
export const evidenceArtifacts = pgTable(
  "evidence_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /**
     * Evidence belongs to an assessment submission or to a work experience
     * logbook entry — exactly one, enforced by a check constraint in
     * policies.sql.
     *
     * One store rather than two, because the Portfolio of Evidence is one
     * thing to an external verifier. Splitting it would mean two hashing
     * paths, two download routes and two integrity checks, and the second of
     * each is where the gap appears.
     */
    submissionId: uuid("submission_id").references(
      () => assessmentSubmissions.id,
      { onDelete: "cascade" },
    ),
    logbookEntryId: uuid("logbook_entry_id"),
    criterionId: uuid("criterion_id").references(() => assessmentCriteria.id, {
      onDelete: "set null",
    }),

    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),

    uploadedById: uuid("uploaded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedIp: text("uploaded_ip"),
    gpsLatitude: numeric("gps_latitude", { precision: 9, scale: 6 }),
    gpsLongitude: numeric("gps_longitude", { precision: 9, scale: 6 }),

    /** Set when a later integrity check found the stored file altered. */
    integrityFailedAt: timestamp("integrity_failed_at", { withTimezone: true }),
  },
  (t) => [
    index("evidence_artifacts_submission_idx").on(t.submissionId),
    index("evidence_artifacts_logbook_entry_idx").on(t.logbookEntryId),
    index("evidence_artifacts_org_idx").on(t.organisationId),
    index("evidence_artifacts_sha256_idx").on(t.sha256),
  ],
);

/**
 * An assessor's judgement, per step 2 of the Section 9 workflow. Immutable
 * once signed: a correction is a new decision, not an edit of this one.
 */
export const assessmentDecisions = pgTable(
  "assessment_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => assessmentSubmissions.id, { onDelete: "cascade" }),
    assessorId: uuid("assessor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    outcome: competencyOutcome("outcome").notNull(),
    /** Per-criterion judgements: { criterionId: "competent" | "not_yet_competent" }. */
    criterionOutcomes: jsonb("criterion_outcomes").$type<
      Record<string, "competent" | "not_yet_competent">
    >(),
    /**
     * What the marks implied at the time, before the assessor decided.
     *
     * Kept beside the decision so a moderator can see where the assessor
     * departed from the arithmetic and read why. Without it, an override is
     * invisible: the record would show only the judgement that survived.
     */
    criterionProposed: jsonb("criterion_proposed").$type<
      Record<string, "competent" | "not_yet_competent">
    >(),
    /**
     * The assessor's reasoning, per criterion.
     *
     * Marks are not the whole picture. Practical performance, workplace
     * evidence and things seen in a simulation do not reach the platform, and
     * the assessor weighs them before calling competence. This is where that
     * reasoning is written down — which is the difference between a defensible
     * judgement and an unexplained one.
     */
    criterionNotes: jsonb("criterion_notes").$type<Record<string, string>>(),
    score: numeric("score", { precision: 6, scale: 2 }),
    comments: text("comments"),

    /** Assessor's registration number as it stood at the time of the decision. */
    assessorRegistrationNumber: text("assessor_registration_number"),
    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    signatureHash: text("signature_hash"),
    /** Set when this decision replaces an earlier one after a referral back. */
    supersedesDecisionId: uuid("supersedes_decision_id"),
  },
  (t) => [
    index("assessment_decisions_submission_idx").on(t.submissionId),
    index("assessment_decisions_assessor_idx").on(t.assessorId),
    index("assessment_decisions_org_idx").on(t.organisationId),
  ],
);

/**
 * Internal moderation, per step 3. A database constraint prevents the
 * moderator being the assessor — segregation of duties is enforced by the
 * database, not left to the interface.
 */
export const moderationRecords = pgTable(
  "moderation_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => assessmentDecisions.id, { onDelete: "cascade" }),
    moderatorId: uuid("moderator_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    outcome: moderationOutcome("outcome").notNull(),
    /** Why this decision was sampled: random, new assessor, borderline, full. */
    samplingReason: text("sampling_reason").notNull(),
    comments: text("comments"),
    /** Set only when the moderator overrode the assessor's judgement. */
    revisedOutcome: competencyOutcome("revised_outcome"),

    moderatorRegistrationNumber: text("moderator_registration_number"),
    actionedAt: timestamp("actioned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    signatureHash: text("signature_hash"),
  },
  (t) => [
    index("moderation_records_decision_idx").on(t.decisionId),
    index("moderation_records_org_idx").on(t.organisationId),
  ],
);

/**
 * A moderation queue entry. Created automatically when a decision is signed
 * and the sampling rule selects it, so moderation is a worklist rather than
 * something someone has to remember to do.
 */
export const moderationQueue = pgTable(
  "moderation_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => assessmentDecisions.id, { onDelete: "cascade" }),
    samplingReason: text("sampling_reason").notNull(),
    assignedModeratorId: uuid("assigned_moderator_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("moderation_queue_decision_idx").on(t.decisionId),
    index("moderation_queue_org_idx").on(t.organisationId),
  ],
);

export const certificates = pgTable(
  "certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolments.id, { onDelete: "restrict" }),

    /** Public reference used to verify the certificate without logging in. */
    verificationReference: text("verification_reference").notNull(),
    /**
     * The twenty random characters of the reference, without the operator's
     * prefix or the grouping hyphens. Verification matches on this rather than
     * on the printed reference, so a platform that changes its name — or is
     * rebranded for a different operator — cannot invalidate certificates it
     * has already issued. Derived by the database, so it can never drift from
     * the reference it belongs to.
     */
    verificationBody: text("verification_body").generatedAlwaysAs(
      sql`right(replace(verification_reference, '-', ''), 20)`,
    ),
    title: text("title").notNull(),
    /** The specific competencies this certificate attests to, frozen at issue. */
    competenciesAttested: jsonb("competencies_attested")
      .notNull()
      .$type<{ code: string; name: string; level?: string }[]>()
      .default([]),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    storageKey: text("storage_key"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("certificates_verification_ref_idx").on(t.verificationReference),
    uniqueIndex("certificates_verification_body_idx").on(t.verificationBody),
    index("certificates_org_idx").on(t.organisationId),
    index("certificates_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Work Integrated Learning
// ---------------------------------------------------------------------------

/**
 * The agreement that puts a learner in a workplace under a named coach.
 *
 * Work experience happens at an employer, supervised by somebody the
 * employer provides. The curriculum is explicit: "the supervisor must provide
 * coaching and must sign the logbook indicating that the learner has gained
 * adequate exposure". This record is what makes that person identifiable at
 * audit — a signature from an unnamed supervisor attests to nothing.
 *
 * The coach's details are copied here as well as linked. People leave
 * employers; the agreement has to keep saying who signed, in what role, at the
 * time.
 */
export const workplaceAgreements = pgTable(
  "workplace_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    coachId: uuid("coach_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "set null" },
    ),

    employerName: text("employer_name").notNull(),
    employerAddress: text("employer_address"),
    coachName: text("coach_name").notNull(),
    coachDesignation: text("coach_designation"),
    coachEmail: text("coach_email").notNull(),

    startDate: timestamp("start_date", { withTimezone: false }),
    endDate: timestamp("end_date", { withTimezone: false }),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("workplace_agreements_org_idx").on(t.organisationId),
    index("workplace_agreements_learner_idx").on(t.learnerId),
    index("workplace_agreements_coach_idx").on(t.coachId),
  ],
);

/**
 * Where a work experience logbook has got to.
 *
 * The order matters and the platform enforces it: a learner records what they
 * did, the coach attests to it, and only then does it reach an assessor. A
 * logbook that reached an assessor without a coach's signature is the exact
 * document an external verifier rejects.
 */
export const logbookStatus = pgEnum("logbook_status", [
  "draft",
  "submitted_to_coach",
  "returned_by_coach",
  "coach_signed",
  "accepted_by_assessor",
]);

export const workplaceLogbooks = pgTable(
  "workplace_logbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => workplaceAgreements.id, { onDelete: "cascade" }),
    learnerId: uuid("learner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The Work Experience Module this logbook covers. */
    curriculumModuleId: uuid("curriculum_module_id")
      .notNull()
      .references(() => curriculumModules.id, { onDelete: "cascade" }),

    status: logbookStatus("status").notNull().default("draft"),
    /** The curriculum states a range; the learner records what it took. */
    hoursClaimed: integer("hours_claimed"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    coachSignedAt: timestamp("coach_signed_at", { withTimezone: true }),
    coachComments: text("coach_comments"),
    /**
     * Hash over what was signed — the coach, the logbook, and every entry as
     * it stood. Not a cryptographic signature, which would need a key the
     * coach does not have, but enough that a later edit is detectable rather
     * than deniable.
     */
    coachSignatureHash: text("coach_signature_hash"),

    assessorId: uuid("assessor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workplace_logbooks_learner_module_idx").on(
      t.learnerId,
      t.curriculumModuleId,
    ),
    index("workplace_logbooks_org_idx").on(t.organisationId),
    index("workplace_logbooks_status_idx").on(t.status),
  ],
);

/**
 * One line of the logbook: a work activity done, a piece of workplace
 * knowledge covered, or a piece of supporting evidence supplied.
 *
 * Generated from the curriculum's own WA / WK / SE lines rather than typed, so
 * a logbook cannot quietly omit a requirement. Evidence files attach through
 * evidence_artifacts, the same store the rest of the Portfolio of Evidence
 * uses.
 */
export const workplaceLogbookEntries = pgTable(
  "workplace_logbook_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    logbookId: uuid("logbook_id")
      .notNull()
      .references(() => workplaceLogbooks.id, { onDelete: "cascade" }),
    topicElementId: uuid("topic_element_id")
      .notNull()
      .references(() => curriculumTopicElements.id, { onDelete: "cascade" }),

    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("workplace_logbook_entries_unique_idx").on(
      t.logbookId,
      t.topicElementId,
    ),
    index("workplace_logbook_entries_org_idx").on(t.organisationId),
  ],
);

/**
 * The Statement of Results.
 *
 * The document that admits a learner to the External Integrated Summative
 * Assessment. The qualification document requires the provider to produce one
 * "indicating the final result and the date on which the competence in each
 * module, of each component, was achieved", and the learner presents it, with
 * their identity document, at the assessment centre.
 *
 * Everything it claims is frozen here at issue rather than recomputed when the
 * page is opened. A curriculum can be reimported and a module renamed; the
 * statement a learner is holding must keep saying what it said on the day it
 * was signed, or it is not evidence of anything.
 */
export const statementsOfResults = pgTable(
  "statements_of_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    qualificationId: uuid("qualification_id")
      .notNull()
      .references(() => qualifications.id, { onDelete: "cascade" }),

    /** Checkable by an assessment centre without signing in. */
    verificationReference: text("verification_reference").notNull(),
    /** The reference without its operator prefix. See `certificates`. */
    verificationBody: text("verification_body").generatedAlwaysAs(
      sql`right(replace(verification_reference, '-', ''), 20)`,
    ),

    /**
     * The whole statement as issued: learner, qualification, provider, and
     * every module with its result and the date competence was achieved.
     */
    statement: jsonb("statement")
      .notNull()
      .$type<{
        learner: {
          firstName: string;
          lastName: string;
          nationalId: string | null;
        };
        qualification: {
          title: string;
          saqaId: string | null;
          qctoCode: string | null;
          nqfLevel: number | null;
          totalCredits: number | null;
          assessmentQualityPartner: string | null;
        };
        provider: {
          legalName: string;
          accreditationNumber: string | null;
        };
        modules: {
          code: string;
          title: string;
          component: string;
          credits: number | null;
          route: string;
          result: string;
          achievedAt: string | null;
        }[];
      }>(),

    issuedById: uuid("issued_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("statements_of_results_reference_idx").on(
      t.verificationReference,
    ),
    uniqueIndex("statements_of_results_body_idx").on(t.verificationBody),
    index("statements_of_results_org_idx").on(t.organisationId),
    index("statements_of_results_user_idx").on(t.userId),
  ],
);

/**
 * A parallel form of one assessment.
 *
 * The summative for Study Unit 1 exists as V1 and V2: same pass mark, same
 * criteria, same moderation policy, different questions. Modelling them as two
 * papers of one assessment rather than two assessments is what makes a re-sit
 * a second attempt instead of an unrelated event, and what stops the two
 * drifting apart, since everything that governs them is stated once.
 *
 * A third attempt is oral and carries no items of its own: the assessor works
 * from the same sections and criteria and records what was asked and answered.
 */
export const assessmentPapers = pgTable(
  "assessment_papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),

    /** "V1", "V2". Shown to the assessor, never to the learner. */
    code: text("code").notNull(),
    mode: paperMode("mode").notNull().default("written"),
    status: publishStatus("status").notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("assessment_papers_code_idx").on(t.assessmentId, t.code),
    index("assessment_papers_org_idx").on(t.organisationId),
  ],
);

/**
 * A section of a paper, with its own mark allocation and its own stimulus.
 *
 * Workbook 1 runs Activity 1.1 at four marks, 1.2 at four and 1.3 at fifty.
 * The summative runs Sections A, B and C at 15, 15 and 70, and Section C opens
 * with a scenario that all four of its questions draw on. A stimulus belongs
 * to the section rather than being repeated on each item, because that is what
 * it is: one piece of context, on screen throughout.
 */
export const assessmentSections = pgTable(
  "assessment_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => assessmentPapers.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    /** "Select the most appropriate answer for each question." */
    instruction: text("instruction"),
    /** Shared context the items draw on. Stays on screen while answering. */
    stimulus: text("stimulus"),
    /**
     * What the section is worth, as the paper states it. Checked against the
     * marks on its items rather than derived from them, so a paper whose
     * printed total does not match its questions is caught rather than
     * silently corrected.
     */
    markTotal: integer("mark_total"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("assessment_sections_paper_idx").on(t.paperId, t.sortOrder),
    index("assessment_sections_org_idx").on(t.organisationId),
  ],
);

/**
 * One learner answer to one question.
 *
 * Replaces holding every answer in a single JSON blob on the submission. The
 * blob is fine for a four-question quiz and wrong for a fifty-mark structured
 * paper marked question by question, where an assessor awards seven of ten on
 * C1 and refers C3 back. It is also what makes autosave per question rather
 * than per paper, so a dropped connection costs one answer and not an
 * afternoon.
 */
export const itemResponses = pgTable(
  "item_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => assessmentSubmissions.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => assessmentItems.id, { onDelete: "cascade" }),

    /** Option ids for a selected-response item. */
    selectedOptionIds: jsonb("selected_option_ids").$type<string[]>(),
    /** Written text for a short or long answer. */
    answerText: text("answer_text"),
    /** A number, where the item asks for one. */
    answerNumber: numeric("answer_number", { precision: 14, scale: 4 }),

    /** Awarded by the marking engine, where the item can be marked by one. */
    autoMarks: numeric("auto_marks", { precision: 6, scale: 2 }),

    /**
     * What an assessor actually gave, which is the number that counts.
     *
     * An auto-marked item proposes; a person disposes. Keeping both means a
     * moderator can see where an assessor departed from the engine and why,
     * rather than seeing only the figure that survived.
     */
    awardedMarks: numeric("awarded_marks", { precision: 6, scale: 2 }),
    /** Chosen level per rubric dimension: { dimensionId: levelId }. */
    rubricLevels: jsonb("rubric_levels").$type<Record<string, string>>(),
    /** What the learner is told about this answer. */
    assessorComment: text("assessor_comment"),
    markedById: uuid("marked_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    markedAt: timestamp("marked_at", { withTimezone: true }),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("item_responses_unique_idx").on(t.submissionId, t.itemId),
    index("item_responses_org_idx").on(t.organisationId),
  ],
);

/**
 * Which criteria a question evidences.
 *
 * Replaces the single `criterion_id` on an item, which could only ever hold
 * one. Question 1.3.3 of Workbook 1 is tagged IAC0103 and IAC0104, and an item
 * that can claim only one of them makes the alignment matrix under-report
 * coverage — which is what a moderator writes up. The old column stays for
 * now and is read as a fallback, so nothing authored before this loses its
 * tag.
 */
export const assessmentItemCriteria = pgTable(
  "assessment_item_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => assessmentItems.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => assessmentCriteria.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("assessment_item_criteria_unique_idx").on(
      t.itemId,
      t.criterionId,
    ),
    index("assessment_item_criteria_item_idx").on(t.itemId),
    index("assessment_item_criteria_org_idx").on(t.organisationId),
  ],
);

/**
 * A facilitator returning a marked workbook.
 *
 * Deliberately its own table rather than a flag on `assessment_decisions`.
 * A workbook is developmental: it prepares a learner for the summative and is
 * not a measurement of competence, so what comes back from one is feedback and
 * never a decision. Keeping the two in separate tables makes that wall
 * structural rather than a condition somebody has to remember to write — there
 * is no path from here to the criterion ledger, because there is no row here
 * that readiness reads.
 *
 * `criteriaOfConcern` is the useful part: which criteria the weak answers
 * cluster around, so the learner knows what to re-read before the summative.
 * It is a diagnosis, not a judgement.
 */
export const formativeFeedback = pgTable(
  "formative_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => assessmentSubmissions.id, { onDelete: "cascade" }),
    facilitatorId: uuid("facilitator_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    comments: text("comments").notNull(),
    /** Criterion ids the answers suggest are not yet secure. */
    criteriaOfConcern: jsonb("criteria_of_concern").$type<string[]>(),
    /** Marks out of the paper total, for the learner's own information. */
    marksAwarded: numeric("marks_awarded", { precision: 6, scale: 2 }),
    marksAvailable: numeric("marks_available", { precision: 6, scale: 2 }),

    returnedAt: timestamp("returned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("formative_feedback_submission_idx").on(t.submissionId),
    index("formative_feedback_org_idx").on(t.organisationId),
  ],
);
