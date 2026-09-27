import {
  bigint,
  boolean,
  date,
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
import { organisations, users } from "./tenancy";
import { courses, learningPaths, lessons, qualifications } from "./curriculum";

/**
 * How a learner comes onto a programme.
 *
 * The route decides which documents are required, which is why it is a field
 * rather than an inference. A learnership carries an agreement that a standard
 * enrolment does not; recognition of prior learning carries a portfolio
 * instead of a qualification certificate, because the whole point is that the
 * learning was not formally certificated.
 */
export const enrolmentRoute = pgEnum("enrolment_route", [
  "standard_qualification",
  "skills_programme",
  "learnership",
  "rpl",
  "employment_equity",
]);

export const enrolmentStatus = pgEnum("enrolment_status", [
  "assigned",
  "in_progress",
  "completed",
  "overdue",
  "withdrawn",
  "superseded",
]);

export const progressState = pgEnum("progress_state", [
  "not_started",
  "in_progress",
  "completed",
]);

/**
 * A learner's assignment to a course or a learning path. Exactly one of
 * courseId or learningPathId is set; the check constraint is added in the
 * migration alongside the row-level security policies.
 */
export const enrolments = pgTable(
  "enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "cascade",
    }),
    learningPathId: uuid("learning_path_id").references(() => learningPaths.id, {
      onDelete: "cascade",
    }),
    /** Set when the enrolment counts towards an accredited qualification. */
    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "set null" },
    ),

    status: enrolmentStatus("status").notNull().default("assigned"),
    /** How the learner came to be enrolled: manual, bulk upload, group rule, HRIS. */
    enrolmentSource: text("enrolment_source").notNull().default("manual"),
    /**
     * How the learner came onto the programme, which decides which documents
     * are required of them. Null on an enrolment made before routes existed,
     * and on internal programmes where no statutory route applies.
     */
    route: enrolmentRoute("route"),
    enrolledById: uuid("enrolled_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    dueDate: timestamp("due_date", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("enrolments_org_idx").on(t.organisationId),
    index("enrolments_user_idx").on(t.userId),
    index("enrolments_course_idx").on(t.courseId),
    uniqueIndex("enrolments_user_course_idx").on(t.userId, t.courseId),
  ],
);

/** Completion state for one lesson within one enrolment. */
export const progressRecords = pgTable(
  "progress_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolments.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    state: progressState("state").notNull().default("not_started"),
    timeSpentSeconds: integer("time_spent_seconds").notNull().default(0),
    /** SCORM/cmi5 bookmark, so a learner resumes where they stopped. */
    resumeData: text("resume_data"),
    firstAccessedAt: timestamp("first_accessed_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("progress_records_unique_idx").on(t.enrolmentId, t.lessonId),
    index("progress_records_org_idx").on(t.organisationId),
  ],
);

// ---------------------------------------------------------------------------
// Enrolment documents
//
// A learner is not enrolled by being given a course. Before that there is an
// invoice, a payment, and a set of documents that have to be collected and
// checked: a certified identity document, a certified copy of the highest
// qualification, a current CV. Which ones depends on the route.
//
// The platform held none of it, so the first time anybody discovered a missing
// certified copy was when the statutory return was being assembled - months
// later, when the learner has long since started and the copy is far harder to
// get. Checking at collection is the whole point.
// ---------------------------------------------------------------------------

export const enrolmentDocumentKind = pgEnum("enrolment_document_kind", [
  "certified_id",
  "highest_qualification",
  "cv",
  "proof_of_payment",
  "learnership_agreement",
  "rpl_portfolio",
  "employment_equity_form",
  "other",
]);

/**
 * Whether somebody has looked at it.
 *
 * Three states rather than a boolean, because "nobody has checked this yet" and
 * "somebody checked it and it is wrong" are entirely different positions and a
 * coordinator needs to tell them apart at a glance.
 */
export const documentVerification = pgEnum("document_verification", [
  "pending",
  "accepted",
  "refused",
]);

export const enrolmentDocuments = pgTable(
  "enrolment_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /**
     * Held against the person rather than one enrolment. A certified identity
     * document is a fact about the learner, not about the programme, and
     * asking for it again on their second qualification would be theatre.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    kind: enrolmentDocumentKind("kind").notNull(),

    /** The stored file, hashed the same way assessment evidence is. */
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text("sha256").notNull(),

    /**
     * When the copy was certified.
     *
     * A certified copy goes stale: South African practice treats one as
     * current for three months. Held as a date so the platform can say a copy
     * has expired rather than leaving a coordinator to read the stamp.
     */
    certifiedOn: date("certified_on"),

    verification: documentVerification("verification")
      .notNull()
      .default("pending"),
    verifiedById: uuid("verified_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Why it was refused, which the learner has to be told to fix it. */
    refusedReason: text("refused_reason"),

    /**
     * Set when the document has left this server in a cohort archive.
     *
     * Only once no other enrolment of the learner's still needs it: an
     * identity document is the learner's, not the qualification's.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archiveId: uuid("archive_id"),

    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("enrolment_documents_user_idx").on(t.userId),
    index("enrolment_documents_org_idx").on(t.organisationId),
  ],
);

// ---------------------------------------------------------------------------
// Learning recorded elsewhere
// ---------------------------------------------------------------------------

/**
 * One xAPI statement brought in from another learning system.
 *
 * Roland, 26 September (job sheet A10): a provider's learning records must be
 * able to move to and from another system. Going out, the platform writes its
 * own records as xAPI statements (lib/xapi.ts). Coming in, it keeps each
 * statement as it arrived, matched to a learner by email where one matches,
 * rather than turning it into an enrolment or a result on this platform: a
 * course somebody finished elsewhere was not taught, assessed or moderated
 * here, and the record must not suggest it was.
 *
 * The statement's own id is kept and is unique per provider, so importing the
 * same export twice adds nothing the second time.
 */
export const externalLearningRecords = pgTable(
  "external_learning_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** The learner here it belongs to; null when no learner matched. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    statementId: uuid("statement_id").notNull(),
    /** The actor as the statement names them: an email, or an account name. */
    actor: text("actor").notNull(),
    actorName: text("actor_name"),
    verbId: text("verb_id").notNull(),
    /** "completed", as the statement displays it. */
    verb: text("verb").notNull(),
    objectId: text("object_id").notNull(),
    objectName: text("object_name"),
    success: boolean("success"),
    completion: boolean("completion"),
    scoreScaled: numeric("score_scaled", { precision: 6, scale: 4 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),

    /** The file or system it came from, as the person importing named it. */
    source: text("source").notNull(),
    /** The statement exactly as received. */
    statement: jsonb("statement").notNull(),

    importedById: uuid("imported_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("external_learning_records_statement_idx").on(t.organisationId, t.statementId),
    index("external_learning_records_user_idx").on(t.userId),
  ],
);

/**
 * A provider's own learning record store, which the platform sends every new
 * statement to. Job sheet D6, 27 September 2026.
 *
 * The key is sealed as the AI extension's tokens are (lib/secret-box.ts), shown
 * again only as its last four characters, and removed with the connection.
 * One per provider.
 */
export const recordStoreConnections = pgTable(
  "record_store_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** The store's xAPI address; statements go to `<endpoint>/statements`. */
    endpoint: text("endpoint").notNull(),
    /** The key's name, sent as the username of HTTP Basic authentication. */
    username: text("username").notNull(),
    secretSealed: text("secret_sealed").notNull(),
    secretHint: text("secret_hint").notNull(),
    /**
     * The provider's own address when the connection was made, so statements
     * sent later name the same activities as the ones in a downloaded file.
     */
    activityBase: text("activity_base").notNull(),
    enabled: boolean("enabled").notNull().default(true),

    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /** Why the last attempt failed, in words an administrator can act on. */
    lastError: text("last_error"),

    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("record_store_connections_org_idx").on(t.organisationId)],
);

/** Which statements the provider's record store has accepted, so each goes once. */
export const recordStoreDeliveries = pgTable(
  "record_store_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    statementId: uuid("statement_id").notNull(),
    /** "stored", or "already held" where the store answered that it had it. */
    outcome: text("outcome").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("record_store_deliveries_statement_idx").on(t.organisationId, t.statementId),
  ],
);

/**
 * A SCORM package a lesson plays, unpacked into storage. Job sheet D8,
 * 27 September 2026.
 *
 * The zip stays the lesson's file; its contents are unpacked under
 * `storagePrefix` so a browser can load them one by one, the way a package
 * expects to be served.
 */
export const scormPackages = pgTable(
  "scorm_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    /** "1.2" for now; SCORM 2004 and cmi5 are refused with a reason. */
    version: text("version").notNull(),
    /** The package's own title, from its manifest. */
    title: text("title"),
    /** The file the package starts from, relative to its root. */
    launchPath: text("launch_path").notNull(),
    /** Where the unpacked files live in storage, ending in "/". */
    storagePrefix: text("storage_prefix").notNull(),
    fileCount: integer("file_count").notNull(),
    /** How many separately launched parts it has; only the first is played. */
    scoCount: integer("sco_count").notNull().default(1),
    /** Passed to the package as cmi.launch_data, from its manifest. */
    launchData: text("launch_data"),
    /** A mastery score from the manifest, which decides passed or failed. */
    masteryScore: numeric("mastery_score", { precision: 6, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("scorm_packages_lesson_idx").on(t.lessonId)],
);

/** A learner's progress through a lesson's SCORM package, as it last reported. */
export const scormAttempts = pgTable(
  "scorm_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => enrolments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the package reported: "passed", "completed", "failed", "incomplete", "browsed". */
    lessonStatus: text("lesson_status").notNull().default("not attempted"),
    scoreRaw: numeric("score_raw", { precision: 8, scale: 2 }),
    scoreMin: numeric("score_min", { precision: 8, scale: 2 }),
    scoreMax: numeric("score_max", { precision: 8, scale: 2 }),
    /** Where the learner was, for picking up again. */
    lessonLocation: text("lesson_location"),
    suspendData: text("suspend_data"),
    /** How the learner last left: "suspend" means pick up where they stopped. */
    exitMode: text("exit_mode"),
    /** Time spent in total, in whole seconds, summed from each session. */
    totalSeconds: integer("total_seconds").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("scorm_attempts_enrolment_lesson_idx").on(t.enrolmentId, t.lessonId)],
);
