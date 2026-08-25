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
 * The tripartite curriculum structure. Every occupational qualification
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
 * A qualification or programme a learner is working towards. For an
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
     * Component weightings for the EISA readiness index, copied from the
     * curriculum document. Must sum to 1.
     *
     * Null when the document does not state them, in which case readiness
     * derives them from module credits. There is deliberately no default: the
     * HRM Administrator curriculum states 38/35/27, which is *not* its credit
     * split of 35/35/30, so a plausible-looking default would quietly produce
     * a number that disagrees with the official document while looking right.
     * Better to say "not stated" and derive visibly.
     */
    componentWeights: jsonb("component_weights").$type<{
      knowledge: number;
      practical: number;
      workplace: number;
    }>(),

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
 * The level between a module and its assessment criteria.
 *
 * A curriculum document does not go module → criteria. Every module is
 * divided first, and the division carries its own weighting: KM01 of the HRM
 * Administrator curriculum splits into four topics of 25% each. Flattening
 * that loses the weighting and, with it, any honest statement of how far
 * through a module a learner is.
 *
 * The three components divide differently, which is why `code` is free text
 * rather than a pattern:
 *
 *   Knowledge        Topics            KM0101, KM0102 …
 *   Practical        Skills            PS0101, PS0102 …
 *   Work Experience  Experiences       WE0101, WE0102 …
 */
export const curriculumTopics = pgTable(
  "curriculum_topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    curriculumModuleId: uuid("curriculum_module_id")
      .notNull()
      .references(() => curriculumModules.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),

    /**
     * The percentage the curriculum document gives this topic within its
     * module. Knowledge modules state one; practical and work experience
     * modules generally do not, and null means "share the module evenly with
     * the other topics" rather than "worth nothing".
     */
    weightPercent: integer("weight_percent"),

    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("curriculum_topics_module_code_idx").on(
      t.curriculumModuleId,
      t.code,
    ),
    index("curriculum_topics_org_idx").on(t.organisationId),
  ],
);

/**
 * What a topic is made of, and therefore what the learning material has to
 * cover.
 *
 * These are the KT / PA / AK / WA / WK / SE lines of the curriculum document.
 * They are the specification a course is written against: the Learning
 * Material Matrix asks whether a lesson exists for each of them, which is a
 * different question from whether an assessment exists for each criterion.
 * A course can assess everything it teaches and still not teach everything
 * the curriculum requires.
 */
export const topicElementKind = pgEnum("topic_element_kind", [
  /** KT — knowledge topic element. */
  "knowledge_topic",
  /** PA — practical activity, the required performance. */
  "practical_activity",
  /** AK — applied knowledge that must be mastered to perform the skill. */
  "applied_knowledge",
  /** WA — work activity carried out in the workplace. */
  "work_activity",
  /** WK — contextual workplace knowledge that must be tested. */
  "contextual_knowledge",
  /** SE — supporting evidence the workplace must produce. */
  "supporting_evidence",
]);

export const curriculumTopicElements = pgTable(
  "curriculum_topic_elements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => curriculumTopics.id, { onDelete: "cascade" }),
    kind: topicElementKind("kind").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("curriculum_topic_elements_code_idx").on(t.topicId, t.code),
    index("curriculum_topic_elements_org_idx").on(t.organisationId),
  ],
);

/**
 * Internal Assessment Criteria. These are the specific statements from the
 * official curriculum document that a learner's evidence is judged against,
 * and achieving every one of them across every module is what admits a learner
 * to the EISA. The Learning Material Matrix checks that each is covered by
 * content and tested by an assessment item before a programme can be
 * published.
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

    /**
     * Nullable because a tenant outside the occupational qualification system, or one that captured
     * a qualification before topics existed, still has criteria that belong
     * directly to a module. Readiness treats those as a single implicit topic.
     */
    topicId: uuid("topic_id").references(() => curriculumTopics.id, {
      onDelete: "cascade",
    }),

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
    /**
     * The study unit this course delivers, where it delivers one.
     *
     * A curriculum publishes modules; a provider teaches study units. This is
     * what gives a study unit somewhere to live: its lessons, its workbooks
     * and its summative assessment become one ordered spine on one course.
     * Null for ordinary training that answers to no qualification.
     */
    studyUnitId: uuid("study_unit_id").references(() => studyUnits.id, {
      onDelete: "set null",
    }),
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

/**
 * Which lesson teaches which topic element.
 *
 * The companion to lesson_criteria, and a genuinely different question.
 * lesson_criteria answers "is this criterion assessed by material we hold";
 * this answers "is this piece of the curriculum taught at all". A course can
 * assess everything it teaches and still not teach everything the curriculum
 * document requires — which is precisely the gap an external verifier looks
 * for, because it is invisible from inside a course that hangs together.
 */
export const lessonTopicElements = pgTable(
  "lesson_topic_elements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    topicElementId: uuid("topic_element_id")
      .notNull()
      .references(() => curriculumTopicElements.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("lesson_topic_elements_unique_idx").on(
      t.lessonId,
      t.topicElementId,
    ),
    index("lesson_topic_elements_org_idx").on(t.organisationId),
  ],
);

/**
 * An Exit Level Outcome, and what it is assessed against.
 *
 * ELOs sit above modules: they are what the qualification claims a person can
 * do, and the EISA is set against them. The curriculum's modules are the route
 * to them, which is why one ELO draws on a Knowledge, a Practical and a Work
 * Experience module together.
 *
 * Distinct from assessment_criteria, which are the *internal* criteria a
 * provider assesses module by module. These are the Associated Assessment
 * Criteria published with the qualification, and the two are not
 * interchangeable — conflating them is how a provider ends up believing it has
 * covered an ELO because it covered the modules underneath it.
 */
export const exitLevelOutcomes = pgTable(
  "exit_level_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    qualificationId: uuid("qualification_id")
      .notNull()
      .references(() => qualifications.id, { onDelete: "cascade" }),
    /** "1", "2" … as the qualification document numbers them. */
    number: text("number").notNull(),
    description: text("description").notNull(),
    credits: integer("credits"),
    nqfLevel: integer("nqf_level"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("exit_level_outcomes_qual_number_idx").on(
      t.qualificationId,
      t.number,
    ),
    index("exit_level_outcomes_org_idx").on(t.organisationId),
  ],
);

export const exitLevelOutcomeCriteria = pgTable(
  "exit_level_outcome_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    exitLevelOutcomeId: uuid("exit_level_outcome_id")
      .notNull()
      .references(() => exitLevelOutcomes.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("exit_level_outcome_criteria_org_idx").on(t.organisationId)],
);

/**
 * A Study Unit: how a provider actually delivers the curriculum.
 *
 * The curriculum publishes modules; a provider teaches study units, each bundling
 * the Knowledge, Practical and Work Experience modules that serve one Exit
 * Level Outcome, with its own workbook and summative assessment. Curiosa's
 * 121150 programme runs five of them.
 *
 * This is the provider's structure, not the curriculum's, which is why it is a
 * separate table rather than a column on the module: two providers delivering
 * the same qualification may group it differently, and both are correct.
 */
export const studyUnits = pgTable(
  "study_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    qualificationId: uuid("qualification_id")
      .notNull()
      .references(() => qualifications.id, { onDelete: "cascade" }),
    /** "SU1", "SU2" … */
    code: text("code").notNull(),
    title: text("title").notNull(),
    /**
     * Null for a study unit that serves no ELO. Study Unit 1 of the HRM
     * Administrator programme is exactly that: an introduction carrying
     * credits but aligned to no Exit Level Outcome.
     */
    exitLevelOutcomeId: uuid("exit_level_outcome_id").references(
      () => exitLevelOutcomes.id,
      { onDelete: "set null" },
    ),
    credits: integer("credits"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("study_units_qual_code_idx").on(t.qualificationId, t.code),
    index("study_units_org_idx").on(t.organisationId),
  ],
);

/** Which curriculum modules a study unit delivers. */
export const studyUnitModules = pgTable(
  "study_unit_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    studyUnitId: uuid("study_unit_id")
      .notNull()
      .references(() => studyUnits.id, { onDelete: "cascade" }),
    curriculumModuleId: uuid("curriculum_module_id")
      .notNull()
      .references(() => curriculumModules.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("study_unit_modules_unique_idx").on(
      t.studyUnitId,
      t.curriculumModuleId,
    ),
    index("study_unit_modules_org_idx").on(t.organisationId),
  ],
);

/**
 * What covers a topic element, according to the provider's alignment matrix.
 *
 * The matrix is the document an accreditation visit asks for first: for every
 * line of the curriculum, which workbook teaches it, which assessment tests
 * it, which chapter of the handbook covers it, and which standard, policy or
 * piece of legislation it draws on.
 *
 * One row per (element, kind, reference) rather than a column per kind,
 * because the columns differ by provider — Curiosa's matrix has fourteen, the
 * next provider's will have others — and a schema that changes every time a
 * client arrives is a schema that will be worked around.
 */
export const alignmentResourceKind = pgEnum("alignment_resource_kind", [
  "workbook",
  "summative_assessment",
  "theory_guide",
  "video",
  "standard",
  "legislation",
  "national_document",
  "article",
  "policy",
  "industry_document",
  "code_of_good_practice",
  "other",
]);

export const topicElementAlignment = pgTable(
  "topic_element_alignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    topicElementId: uuid("topic_element_id")
      .notNull()
      .references(() => curriculumTopicElements.id, { onDelete: "cascade" }),
    kind: alignmentResourceKind("kind").notNull(),
    /** "SA2", "Chapter 2", "BCEA s.29" — as the matrix writes it. */
    reference: text("reference").notNull(),
  },
  (t) => [
    uniqueIndex("topic_element_alignment_unique_idx").on(
      t.topicElementId,
      t.kind,
      t.reference,
    ),
    index("topic_element_alignment_org_idx").on(t.organisationId),
  ],
);

/**
 * What a programme document is, in the provider's own design process.
 *
 * Taken from the four-step design sequence a provider actually follows —
 * align, write the handbook, write the workbooks, write the assessments — plus
 * the workplace pack and the programme-level artefacts an accreditation visit
 * asks for. A document whose kind is unknown is still worth holding, hence
 * "other": refusing an upload because it has no category is how documents end
 * up on somebody's laptop instead.
 */
export const programmeDocumentKind = pgEnum("programme_document_kind", [
  // Published by SAQA/QCTO. The authority everything else is checked against.
  "qualification_document",
  "curriculum_document",
  "assessment_specification",
  // Step 1: the master alignment of curriculum to delivery.
  "alignment_matrix",
  // Step 2: the learning material itself.
  "learner_handbook",
  "theory_guide",
  // Step 3: what the learner works through, and how it is marked.
  "workbook",
  "workbook_memorandum",
  // Step 4: summative assessment, and how it is marked.
  "summative_assessment",
  "summative_memorandum",
  // The workplace pack.
  "workplace_signoff",
  "workplace_coach_guide",
  "workplace_agreement",
  // Programme-level.
  "learning_programme_guide",
  "facilitation_plan",
  "rollout_schedule",
  "induction",
  "learning_roadmap",
  "other",
]);

/**
 * A document produced outside the platform and held against the programme.
 *
 * The handbooks, workbooks, memoranda and sign-off sheets are written in Word
 * and Excel and always will be — they are print artefacts a moderator marks up
 * by hand. What matters is that the platform holds the authoritative copy, at
 * a known version, attached to the part of the curriculum it serves, so that
 * "which workbook covers KM0201, and which version did this cohort sit" has an
 * answer that does not depend on somebody's filing.
 *
 * Attached at whichever level fits: a handbook belongs to the qualification, a
 * workbook to a study unit, a sign-off sheet to a work experience module.
 * Exactly one of the three is set.
 */
export const programmeDocuments = pgTable(
  "programme_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    qualificationId: uuid("qualification_id").references(
      () => qualifications.id,
      { onDelete: "cascade" },
    ),
    studyUnitId: uuid("study_unit_id").references(() => studyUnits.id, {
      onDelete: "cascade",
    }),
    curriculumModuleId: uuid("curriculum_module_id").references(
      () => curriculumModules.id,
      { onDelete: "cascade" },
    ),

    kind: programmeDocumentKind("kind").notNull(),
    title: text("title").notNull(),
    /** The provider's own version marker: "V2", "Final", "07072025". */
    version: text("version"),

    filename: text("filename").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /**
     * Hashed on the way in, like assessment evidence. A moderator asking
     * whether the file they were sent is the file the platform holds gets a
     * check rather than an assurance.
     */
    sha256: text("sha256").notNull(),

    /** Plain text pulled out of the file, for searching. Null for PDFs. */
    extractedText: text("extracted_text"),

    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    supersedesId: uuid("supersedes_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("programme_documents_org_idx").on(t.organisationId),
    index("programme_documents_qualification_idx").on(t.qualificationId),
    index("programme_documents_study_unit_idx").on(t.studyUnitId),
    index("programme_documents_sha256_idx").on(t.sha256),
  ],
);
