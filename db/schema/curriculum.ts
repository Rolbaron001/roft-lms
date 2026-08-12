import {
  bigint,
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
import { competencies, organisations, users } from "./tenancy";

/**
 * The QCTO tripartite curriculum structure. Every occupational qualification
 * registered on the Occupational Qualifications Sub-Framework is delivered,
 * tracked and assessed across these three components, and they are weighted
 * differently in the readiness calculation, so the distinction is a column
 * rather than a tag.
 *
 * A tenant running ordinary corporate training uses "general" and never sees
 * the other three.
 */
export const curriculumComponent = pgEnum("curriculum_component", [
  "knowledge",
  "practical",
  "workplace",
  "general",
]);

export const publishStatus = pgEnum("publish_status", [
  "draft",
  "in_review",
  "published",
  "archived",
]);

export const contentType = pgEnum("content_type", [
  "text",
  "video",
  "document",
  "slide_deck",
  "scorm",
  "cmi5",
  "external_link",
  "live_session",
  "quiz",
  "practical_task",
  "workplace_logbook",
  // Added with file uploads: a diagram or a recorded briefing is ordinary
  // course material and was previously being filed as "document".
  "image",
  "audio",
]);

/**
 * A qualification or programme a learner is working towards. For a QCTO
 * occupational qualification this carries the SAQA and QCTO identifiers the
 * statutory exports need. For ordinary corporate training it is optional —
 * a course can stand alone.
 */
export const qualifications = pgTable(
  "qualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),

    // Statutory identifiers. Null for a non-accredited internal programme.
    saqaId: text("saqa_id"),
    qctoCode: text("qcto_code"),
    ofoCode: text("ofo_code"),
    nqfLevel: integer("nqf_level"),
    totalCredits: integer("total_credits"),
    /** The Assessment Quality Partner that administers the final EISA. */
    assessmentQualityPartner: text("assessment_quality_partner"),
    registrationStartDate: timestamp("registration_start_date", {
      withTimezone: false,
    }),
    registrationEndDate: timestamp("registration_end_date", {
      withTimezone: false,
    }),

    /**
     * Component weightings used by the EISA readiness index, mirroring the
     * credit weighting in the official curriculum document. Must sum to 1.
     */
    componentWeights: jsonb("component_weights")
      .notNull()
      .$type<{ knowledge: number; practical: number; workplace: number }>()
      .default({ knowledge: 0.4, practical: 0.3, workplace: 0.3 }),

    status: publishStatus("status").notNull().default("draft"),
    version: text("version").notNull().default("1.0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("qualifications_org_idx").on(t.organisationId),
    uniqueIndex("qualifications_org_qcto_code_idx").on(
      t.organisationId,
      t.qctoCode,
    ),
  ],
);

/**
 * A curriculum module within a qualification: one Knowledge, Practical or
 * Workplace Experience module as named in the official curriculum document.
 * This is the statutory unit — courses are the delivery vehicle for it.
 */
export const curriculumModules = pgTable(
  "curriculum_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    qualificationId: uuid("qualification_id")
      .notNull()
      .references(() => qualifications.id, { onDelete: "cascade" }),
    component: curriculumComponent("component").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    credits: integer("credits"),
    notionalHours: integer("notional_hours"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("curriculum_modules_qual_code_idx").on(
      t.qualificationId,
      t.code,
    ),
    index("curriculum_modules_org_idx").on(t.organisationId),
  ],
);

/**
 * Internal Assessment Criteria. These are the specific statements from the
 * official curriculum document that a learner's evidence is judged against.
 * The Learning Material Matrix checks that every one of them is covered by
 * some piece of content and tested by some assessment item before a programme
 * can be published.
 */
export const assessmentCriteria = pgTable(
  "assessment_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    curriculumModuleId: uuid("curriculum_module_id")
      .notNull()
      .references(() => curriculumModules.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    description: text("description").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("assessment_criteria_module_code_idx").on(
      t.curriculumModuleId,
      t.code,
    ),
    index("assessment_criteria_org_idx").on(t.organisationId),
  ],
);

/**
 * A course: the thing an instructor authors and a learner works through.
 * Optionally bound to a curriculum module, which is what makes it count
 * towards an accredited qualification.
 */
export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    curriculumModuleId: uuid("curriculum_module_id").references(
      () => curriculumModules.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    description: text("description"),
    /**
     * Courses are versioned. Publishing a new version leaves a finished
     * learner's completion record untouched but flags anyone mid-course.
     */
    version: integer("version").notNull().default(1),
    supersedesCourseId: uuid("supersedes_course_id"),
    status: publishStatus("status").notNull().default("draft"),
    estimatedMinutes: integer("estimated_minutes"),
    thumbnailUrl: text("thumbnail_url"),
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("courses_org_idx").on(t.organisationId),
    index("courses_curriculum_module_idx").on(t.curriculumModuleId),
  ],
);

/** A section within a course. */
export const courseSections = pgTable(
  "course_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("course_sections_course_idx").on(t.courseId),
    index("course_sections_org_idx").on(t.organisationId),
  ],
);

/** A single piece of content a learner consumes. */
export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => courseSections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contentType: contentType("content_type").notNull().default("text"),
    /** Rich text body, for text lessons. */
    body: text("body"),
    /** Object-storage key for video, documents and SCORM packages. */
    storageKey: text("storage_key"),
    /**
     * What the uploaded file actually is, decided by reading its leading
     * bytes rather than trusting the name or what the browser claimed. The
     * player uses this to decide how to present it, and the download route
     * uses it as the content type it serves back.
     */
    mediaMimeType: text("media_mime_type"),
    mediaFilename: text("media_filename"),
    mediaSizeBytes: bigint("media_size_bytes", { mode: "number" }),
    mediaSha256: text("media_sha256"),
    externalUrl: text("external_url"),
    durationMinutes: integer("duration_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    isMandatory: integer("is_mandatory").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lessons_section_idx").on(t.sectionId),
    index("lessons_org_idx").on(t.organisationId),
  ],
);

/**
 * Tags a course to a competency. Section 4.2 of the design document: this is
 * what turns completion data into capability coverage.
 */
export const courseCompetencies = pgTable(
  "course_competencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    competencyId: uuid("competency_id")
      .notNull()
      .references(() => competencies.id, { onDelete: "cascade" }),
    /** Which proficiency level completing this course attests to. */
    proficiencyLevel: text("proficiency_level"),
  },
  (t) => [
    uniqueIndex("course_competencies_unique_idx").on(t.courseId, t.competencyId),
    index("course_competencies_org_idx").on(t.organisationId),
  ],
);

/**
 * Maps a lesson to the Internal Assessment Criteria it covers. The Learning
 * Material Matrix reads this to find gaps: a criterion with no lesson behind it
 * blocks publication of the programme.
 */
export const lessonCriteria = pgTable(
  "lesson_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => assessmentCriteria.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("lesson_criteria_unique_idx").on(t.lessonId, t.criterionId),
    index("lesson_criteria_org_idx").on(t.organisationId),
  ],
);

/** An ordered sequence of courses, per Section 4.3. */
export const learningPaths = pgTable(
  "learning_paths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    description: text("description"),
    status: publishStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("learning_paths_org_idx").on(t.organisationId)],
);

export const learningPathCourses = pgTable(
  "learning_path_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    learningPathId: uuid("learning_path_id")
      .notNull()
      .references(() => learningPaths.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Must the previous course be complete before this one opens? */
    requiresPrevious: integer("requires_previous").notNull().default(1),
  },
  (t) => [
    uniqueIndex("learning_path_courses_unique_idx").on(
      t.learningPathId,
      t.courseId,
    ),
    index("learning_path_courses_org_idx").on(t.organisationId),
  ],
);
