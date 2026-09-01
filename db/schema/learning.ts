import {
  bigint,
  date,
  index,
  integer,
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
