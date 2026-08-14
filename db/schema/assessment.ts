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
  "scenario",
  "file_upload",
  "observation_checklist",
]);

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

    /**
     * Proportion of this assessment's decisions routed to a moderator, as a
     * fraction. The QCTO baseline is 0.25; an externally accredited summative
     * assessment is set to 1.0 so every decision is moderated.
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

    type: itemType("type").notNull().default("multiple_choice"),
    stem: text("stem").notNull(),
    /** Answer options for a selected-response item: [{ id, text }]. */
    options: jsonb("options").$type<{ id: string; text: string }[]>(),
    /** Option ids that count as correct. Never sent to a learner's browser. */
    correctOptionIds: jsonb("correct_option_ids").$type<string[]>(),
    /** Marking guidance for a human-marked item. */
    markingGuide: text("marking_guide"),
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
 * QCTO work experience happens at an employer, supervised by somebody the
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
    index("statements_of_results_org_idx").on(t.organisationId),
    index("statements_of_results_user_idx").on(t.userId),
  ],
);
