import {
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
import {
  courses,
  curriculumModules,
  lessons,
  programmeDocuments,
  qualifications,
} from "./curriculum";
import { assessments } from "./assessment";

/**
 * The spine: the one ordered list a learner walks through a course.
 *
 * Before this, a course held sections and lessons in one list and assessments
 * in another, with no position between them. There was no single answer to
 * "what comes next", which is exactly what gating needs — so the ordering and
 * the gates live here, in one sequence, rather than being inferred from two.
 *
 * A step points at exactly one thing. Which one is named by `kind`, and a
 * check constraint in db/policies.sql enforces that precisely that column is
 * set — the same one-owner pattern the evidence store uses, for the same
 * reason: a row that claims to be two things is a row nothing can reason
 * about.
 */
export const stepKind = pgEnum("step_kind", [
  /** A lesson to work through. */
  "lesson",
  /** An assessment to sit, formative or summative. */
  "assessment",
  /** A document to read or download — a theory guide, a roadmap. */
  "document",
  /**
   * A work experience module, evidenced by a signed logbook. The step names
   * the module; the learner's own logbook is found from that and from them.
   */
  "workplace",
]);

/**
 * How a step is released.
 *
 * `sequential` is a convenience that means "the step before this one on the
 * spine", so an author does not write the obvious prerequisite by hand. It is
 * not a separate mechanism: it is evaluated as though that prerequisite had
 * been written, under the rule named in `sequentialRule`.
 */
export const stepRelease = pgEnum("step_release", [
  "open",
  "sequential",
  "prerequisites",
]);

/**
 * What "completed" has to mean for a prerequisite to be satisfied.
 *
 * These are deliberately five and not one. A workbook is developmental: it
 * prepares a learner for the summative and is not a measurement of competence,
 * so the gate between one workbook and the next is `submitted` and cannot be
 * `competent` — there is no competence decision to wait for. Competence is
 * measured by the summative, and it is what opens the next study unit.
 */
export const prerequisiteRule = pgEnum("prerequisite_rule", [
  /** Viewed. Enough for a reading step. */
  "opened",
  /** Handed in. The workbook-to-workbook rule. */
  "submitted",
  /** A facilitator has returned feedback. Stronger, still not a decision. */
  "reviewed",
  /** An assessor judged a summative competent and moderation has settled. */
  "competent",
  /** A logbook signed by the coach and accepted by an assessor. */
  "signed_off",
]);

export const courseSteps = pgTable(
  "course_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),

    kind: stepKind("kind").notNull(),

    // Exactly one of these four is set, matching `kind`.
    lessonId: uuid("lesson_id").references(() => lessons.id, {
      onDelete: "cascade",
    }),
    assessmentId: uuid("assessment_id").references(() => assessments.id, {
      onDelete: "cascade",
    }),
    programmeDocumentId: uuid("programme_document_id").references(
      () => programmeDocuments.id,
      { onDelete: "cascade" },
    ),
    curriculumModuleId: uuid("curriculum_module_id").references(
      () => curriculumModules.id,
      { onDelete: "cascade" },
    ),

    /** Shown to the learner. Falls back to the target's own title when null. */
    title: text("title"),
    /** One line of context above the step. */
    guidance: text("guidance"),

    release: stepRelease("release").notNull().default("sequential"),
    /** Which rule `sequential` applies to the step before this one. */
    sequentialRule: prerequisiteRule("sequential_rule")
      .notNull()
      .default("opened"),

    /**
     * A step held shut until a date, and closed after one. Set per course for
     * now; when cohorts arrive these are derived from the cohort's start so
     * one change moves every date for everyone in it.
     */
    availableFrom: timestamp("available_from", { withTimezone: true }),
    availableUntil: timestamp("available_until", { withTimezone: true }),

    /**
     * A step a learner may skip. Optional steps still appear and can still be
     * worked, but they gate nothing and do not hold anyone up.
     */
    optional: integer("optional").notNull().default(0),

    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("course_steps_course_idx").on(t.courseId, t.sortOrder),
    index("course_steps_org_idx").on(t.organisationId),
    index("course_steps_lesson_idx").on(t.lessonId),
    index("course_steps_assessment_idx").on(t.assessmentId),
  ],
);

/**
 * What a step waits for.
 *
 * Prerequisites are ANDed: every one must be satisfied. A group of them may be
 * marked with the same `anyOfGroup` label, and then any one of that group is
 * enough — for genuinely equivalent alternatives, not as a way to soften a
 * gate that should have been written differently.
 */
export const courseStepPrerequisites = pgTable(
  "course_step_prerequisites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => courseSteps.id, { onDelete: "cascade" }),
    /** The step that must be satisfied first. */
    requiredStepId: uuid("required_step_id")
      .notNull()
      .references(() => courseSteps.id, { onDelete: "cascade" }),
    rule: prerequisiteRule("rule").notNull(),
    /** Prerequisites sharing a label satisfy the step if any one of them does. */
    anyOfGroup: text("any_of_group"),
  },
  (t) => [
    uniqueIndex("course_step_prerequisites_unique_idx").on(
      t.stepId,
      t.requiredStepId,
      t.rule,
    ),
    index("course_step_prerequisites_step_idx").on(t.stepId),
    index("course_step_prerequisites_org_idx").on(t.organisationId),
  ],
);

/**
 * A named exception for a named learner.
 *
 * Real programmes need them: a learner joins late, a workbook is lost, an
 * assessor is on leave. What matters is that an exception is visible. It is
 * written to the audit log, shown on the learner's record and listed in the
 * moderation pack, because an exception nobody can see is indistinguishable
 * from a broken gate.
 */
export const stepOverrides = pgTable(
  "step_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => courseSteps.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Required. An override without a reason is not an override, it is a hole. */
    reason: text("reason").notNull(),
    grantedById: uuid("granted_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set when it is withdrawn, rather than deleted, so the record survives. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("step_overrides_step_user_idx").on(t.stepId, t.userId),
    index("step_overrides_org_idx").on(t.organisationId),
  ],
);

/**
 * That a learner opened a step.
 *
 * Lessons record completion of their own and assessments record submissions,
 * but neither answers "has this learner looked at it yet" for a step that is
 * only a document to read. Rather than infer opening from four different
 * places — and get it wrong for the one kind that has nowhere to look — every
 * step records it here, uniformly.
 *
 * A document step gated on `opened` and with no way to record an open would
 * hold every step after it shut for ever, which is the failure this exists to
 * prevent.
 */
export const stepProgress = pgTable(
  "step_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => courseSteps.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("step_progress_unique_idx").on(t.stepId, t.userId),
    index("step_progress_org_idx").on(t.organisationId),
  ],
);

/**
 * An uploaded document waiting for a person to confirm what was read out of it.
 *
 * The pipeline never commits what it parses. A parser that gets question
 * three's correct answer wrong produces confidently wrong marking, and nobody
 * finds out until a moderator does — or until a learner appeals. So the parse
 * lands here as a proposal, with everything it could not work out listed
 * beside it, and somebody holding `assessment:author` accepts responsibility
 * for it before any of it becomes an assessment.
 *
 * The source files are kept and hashed even after a successful commit, so a
 * dispute about what a question said is settled against the file the author
 * wrote rather than against the platform's reading of it.
 */
export const captureJobs = pgTable(
  "capture_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    /** The learner's copy, and the answer guide beside it. */
    paperFilename: text("paper_filename").notNull(),
    paperStorageKey: text("paper_storage_key").notNull(),
    paperSha256: text("paper_sha256").notNull(),
    guideFilename: text("guide_filename"),
    guideStorageKey: text("guide_storage_key"),
    guideSha256: text("guide_sha256"),

    /**
     * The qualification this material belongs to, chosen at upload.
     *
     * Named rather than guessed from the filename: the criteria a question
     * evidences are looked up against this qualification's curriculum, and
     * getting it from a filename would mean a typo silently tagging questions
     * to the wrong programme.
     */
    qualificationId: uuid("qualification_id").references(() => qualifications.id, {
      onDelete: "cascade",
    }),

    /** What the filename said, under this tenant's own naming convention. */
    classified: jsonb("classified").$type<Record<string, string | null>>(),

    /** The parsed structure, exactly as proposed. */
    proposal: jsonb("proposal").notNull(),
    /** Everything the parser could not work out, for the review screen. */
    problems: jsonb("problems").$type<string[]>().notNull(),

    uploadedById: uuid("uploaded_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Who took responsibility for it, and when. Null until confirmed. */
    committedById: uuid("committed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    /** The paper this became, once committed. */
    paperId: uuid("paper_id"),
  },
  (t) => [
    index("capture_jobs_org_idx").on(t.organisationId),
    index("capture_jobs_sha_idx").on(t.paperSha256),
  ],
);

/**
 * A named group working through a programme together, on a schedule.
 *
 * Before this the platform enrolled individuals, and a facilitator setting
 * dates set them learner by learner — which drifts the moment anything moves.
 * A cohort has one start date, and every step's window is expressed as an
 * offset from it. Moving the start by a week moves every date for everyone in
 * the group, once.
 */
export const cohortStatus = pgEnum("cohort_status", [
  "planned",
  "running",
  "finished",
  "cancelled",
]);

export const cohorts = pgTable(
  "cohorts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),

    /** The course this cohort walks. */
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),

    /** "HRM Officer 2026 Intake 1". */
    name: text("name").notNull(),
    /** Short reference used on registers and returns. */
    code: text("code"),

    /**
     * The date everything else is measured from. Held as a date rather than a
     * timestamp: a cohort starts on a day, in the provider's own week, and
     * pinning it to an instant only invites time-zone arguments.
     */
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),

    facilitatorId: uuid("facilitator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: cohortStatus("status").notNull().default("planned"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cohorts_course_idx").on(t.courseId),
    index("cohorts_org_idx").on(t.organisationId),
  ],
);

export const cohortMembers = pgTable(
  "cohort_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohorts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set rather than deleted, so a register a year old still reads true. */
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("cohort_members_unique_idx").on(t.cohortId, t.userId),
    index("cohort_members_user_idx").on(t.userId),
    index("cohort_members_org_idx").on(t.organisationId),
  ],
);

/**
 * When a step opens and when it is due, for one cohort.
 *
 * Expressed in days from the cohort's start rather than as dates. That is the
 * whole point: a rollout schedule is written as "workbook 3 in week four", and
 * holding it that way means a delayed intake is one edit rather than forty.
 *
 * A step with no row here is governed by whatever the course itself says,
 * which for most steps is nothing at all.
 */
export const stepReleases = pgTable(
  "step_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohorts.id, { onDelete: "cascade" }),
    stepId: uuid("step_id")
      .notNull()
      .references(() => courseSteps.id, { onDelete: "cascade" }),

    /** Days after the cohort starts before this opens. Null means at once. */
    opensAfterDays: integer("opens_after_days"),
    /** Days after the cohort starts by which it should be done. */
    dueAfterDays: integer("due_after_days"),
    /** Days after the due date before it shuts entirely. Null means never. */
    closesAfterDays: integer("closes_after_days"),
  },
  (t) => [
    uniqueIndex("step_releases_unique_idx").on(t.cohortId, t.stepId),
    index("step_releases_cohort_idx").on(t.cohortId),
    index("step_releases_org_idx").on(t.organisationId),
  ],
);
