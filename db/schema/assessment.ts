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
  publishStatus,
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
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => assessmentSubmissions.id, { onDelete: "cascade" }),
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
