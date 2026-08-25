import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  competencies,
  courseCompetencies,
  courseSections,
  courses,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  lessonCriteria,
  lessons,
  exitLevelOutcomeCriteria,
  exitLevelOutcomes,
  qualifications,
  studyUnitModules,
  studyUnits,
  topicElementAlignment,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Course and curriculum authoring.
 *
 * Two rules run through all of it, and they are the reason the platform is
 * worth more than a folder of videos:
 *
 *   1. A course cannot be published without being tagged to a competency.
 *      Untagged content cannot be reported on as capability coverage, and
 *      capability coverage is the product.
 *
 *   2. A course delivering an accredited curriculum module cannot be published
 *      while any Internal Assessment Criterion has no content behind it. This
 *      is the Learning Material Matrix: the gap is caught at authoring time,
 *      not discovered by an external verifier a year later.
 *
 * Both are enforced here rather than in the interface, so they hold for any
 * future caller — an import routine, an API, a bulk tool.
 */

export class AuthoringError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_publishable"
      | "invalid_state"
      | "invalid_input",
  ) {
    super(message);
    this.name = "AuthoringError";
  }
}

// ---------------------------------------------------------------------------
// Qualifications and the tripartite curriculum
// ---------------------------------------------------------------------------

export const qualificationInput = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(4000).optional(),
  saqaId: z.string().trim().max(50).optional(),
  qctoCode: z.string().trim().max(50).optional(),
  ofoCode: z.string().trim().max(50).optional(),
  nqfLevel: z.coerce.number().int().min(1).max(10).optional(),
  totalCredits: z.coerce.number().int().min(0).max(10_000).optional(),
  assessmentQualityPartner: z.string().trim().max(300).optional(),
  componentWeights: z
    .object({
      knowledge: z.number().min(0).max(1),
      practical: z.number().min(0).max(1),
      workplace: z.number().min(0).max(1),
    })
    .refine(
      (weights) =>
        Math.abs(
          weights.knowledge + weights.practical + weights.workplace - 1,
        ) < 0.001,
      { message: "Component weights must add up to 1." },
    )
    .optional(),
});

export type QualificationInput = z.infer<typeof qualificationInput>;

export async function createQualification(
  session: AuthenticatedSession,
  input: QualificationInput,
) {
  assertSessionCan(session, "qualification:manage");
  const parsed = qualificationInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(qualifications)
      .values({
        organisationId: session.organisationId,
        title: parsed.title,
        description: parsed.description ?? null,
        saqaId: parsed.saqaId ?? null,
        qctoCode: parsed.qctoCode ?? null,
        ofoCode: parsed.ofoCode ?? null,
        nqfLevel: parsed.nqfLevel ?? null,
        totalCredits: parsed.totalCredits ?? null,
        assessmentQualityPartner: parsed.assessmentQualityPartner ?? null,
        ...(parsed.componentWeights
          ? { componentWeights: parsed.componentWeights }
          : {}),
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "qualification.created",
      entityType: "qualification",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

export async function listQualifications(session: AuthenticatedSession) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: qualifications.id,
        title: qualifications.title,
        qctoCode: qualifications.qctoCode,
        saqaId: qualifications.saqaId,
        nqfLevel: qualifications.nqfLevel,
        totalCredits: qualifications.totalCredits,
        status: qualifications.status,
        // Correlated subqueries are written as literal SQL with explicit
        // aliases. Interpolating column references into a raw fragment emits
        // them unqualified, which Postgres rejects as ambiguous once two
        // tables in scope share a column name.
        moduleCount: sql<number>`(
          select count(*)::int from curriculum_modules cm
          where cm.qualification_id = qualifications.id
        )`,
      })
      .from(qualifications)
      .orderBy(asc(qualifications.title)),
  );
}

export const curriculumModuleInput = z.object({
  qualificationId: z.string().uuid(),
  component: z.enum(["knowledge", "practical", "workplace", "general"]),
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(4000).optional(),
  credits: z.coerce.number().int().min(0).max(1000).optional(),
  notionalHours: z.coerce.number().int().min(0).max(10_000).optional(),
});

export async function addCurriculumModule(
  session: AuthenticatedSession,
  input: z.infer<typeof curriculumModuleInput>,
) {
  assertSessionCan(session, "qualification:manage");
  const parsed = curriculumModuleInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select({ id: qualifications.id })
      .from(qualifications)
      .where(eq(qualifications.id, parsed.qualificationId));

    if (!qualification) {
      throw new AuthoringError("Qualification not found.", "not_found");
    }

    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, parsed.qualificationId));

    const [created] = await tx
      .insert(curriculumModules)
      .values({
        organisationId: session.organisationId,
        qualificationId: parsed.qualificationId,
        component: parsed.component,
        code: parsed.code,
        title: parsed.title,
        description: parsed.description ?? null,
        credits: parsed.credits ?? null,
        notionalHours: parsed.notionalHours ?? null,
        sortOrder: existing,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "curriculum_module.created",
      entityType: "curriculum_module",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

/**
 * The whole curriculum of one qualification, down to the last line.
 *
 * Distinct from listCurriculumModules, which returns counts for a summary
 * list. This is what somebody checking the platform against the printed
 * curriculum document needs: the same codes in the same order, so the two can
 * be read side by side.
 */
export async function curriculumOutline(
  session: AuthenticatedSession,
  qualificationId: string,
) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select()
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!qualification) {
      throw new AuthoringError("Qualification not found.", "not_found");
    }

    const modules = await tx
      .select({
        id: curriculumModules.id,
        component: curriculumModules.component,
        code: curriculumModules.code,
        title: curriculumModules.title,
        description: curriculumModules.description,
        credits: curriculumModules.credits,
        sortOrder: curriculumModules.sortOrder,
      })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId))
      .orderBy(asc(curriculumModules.sortOrder));

    const moduleIds = modules.map((m) => m.id);

    const topics = moduleIds.length
      ? await tx
          .select()
          .from(curriculumTopics)
          .where(inArray(curriculumTopics.curriculumModuleId, moduleIds))
          .orderBy(asc(curriculumTopics.sortOrder))
      : [];

    const topicIds = topics.map((t) => t.id);

    const elements = topicIds.length
      ? await tx
          .select()
          .from(curriculumTopicElements)
          .where(inArray(curriculumTopicElements.topicId, topicIds))
          .orderBy(asc(curriculumTopicElements.sortOrder))
      : [];

    const criteria = moduleIds.length
      ? await tx
          .select()
          .from(assessmentCriteria)
          .where(inArray(assessmentCriteria.curriculumModuleId, moduleIds))
          .orderBy(asc(assessmentCriteria.sortOrder))
      : [];

    // What the provider's alignment matrix says covers each line. Read from an
    // uploaded spreadsheet, so it is shown beside the curriculum rather than
    // left in the file it came from.
    const elementIds = elements.map((e) => e.id);
    const alignment = elementIds.length
      ? await tx
          .select()
          .from(topicElementAlignment)
          .where(inArray(topicElementAlignment.topicElementId, elementIds))
      : [];

    // How the provider delivers it: study units bundling the modules that
    // serve one Exit Level Outcome. Read alongside the modules rather than
    // instead of them, because a moderator checks both - the curriculum publishes
    // modules, the provider teaches study units.
    const units = await tx
      .select()
      .from(studyUnits)
      .where(eq(studyUnits.qualificationId, qualificationId))
      .orderBy(asc(studyUnits.sortOrder));

    const unitModules = units.length
      ? await tx
          .select()
          .from(studyUnitModules)
          .where(
            inArray(
              studyUnitModules.studyUnitId,
              units.map((unit) => unit.id),
            ),
          )
      : [];

    const outcomes = await tx
      .select()
      .from(exitLevelOutcomes)
      .where(eq(exitLevelOutcomes.qualificationId, qualificationId))
      .orderBy(asc(exitLevelOutcomes.sortOrder));

    const outcomeCriteria = outcomes.length
      ? await tx
          .select()
          .from(exitLevelOutcomeCriteria)
          .where(
            inArray(
              exitLevelOutcomeCriteria.exitLevelOutcomeId,
              outcomes.map((outcome) => outcome.id),
            ),
          )
          .orderBy(asc(exitLevelOutcomeCriteria.sortOrder))
      : [];

    // Built once so a study unit points at the outcome complete with its
    // associated assessment criteria, rather than at the bare row.
    const outcomesWithCriteria = outcomes.map((outcome) => ({
      ...outcome,
      criteria: outcomeCriteria.filter(
        (criterion) => criterion.exitLevelOutcomeId === outcome.id,
      ),
    }));

    return {
      qualification,
      outcomes: outcomesWithCriteria,
      studyUnits: units.map((unit) => ({
        ...unit,
        outcome:
          outcomesWithCriteria.find((o) => o.id === unit.exitLevelOutcomeId) ??
          null,
        modules: unitModules
          .filter((link) => link.studyUnitId === unit.id)
          .map((link) =>
            modules.find((m) => m.id === link.curriculumModuleId),
          )
          .filter((m): m is (typeof modules)[number] => Boolean(m))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      })),
      /** Modules no study unit delivers, which means they are not taught. */
      unplacedModules: modules.filter(
        (m) => !unitModules.some((link) => link.curriculumModuleId === m.id),
      ),
      modules: modules.map((curriculumModule) => ({
        ...curriculumModule,
        topics: topics
          .filter((t) => t.curriculumModuleId === curriculumModule.id)
          .map((topic) => ({
            ...topic,
            elements: elements
              .filter((e) => e.topicId === topic.id)
              .map((element) => ({
                ...element,
                coveredBy: alignment.filter(
                  (a) => a.topicElementId === element.id,
                ),
              })),
            criteria: criteria.filter((c) => c.topicId === topic.id),
          })),
        // Criteria captured before topics existed, or by a tenant not using
        // them. Shown separately rather than hidden.
        looseCriteria: criteria.filter(
          (c) => c.curriculumModuleId === curriculumModule.id && !c.topicId,
        ),
      })),
    };
  });
}

export const criterionInput = z.object({
  curriculumModuleId: z.string().uuid(),
  code: z.string().trim().min(1).max(50),
  description: z.string().trim().min(3).max(2000),
});

export async function addAssessmentCriterion(
  session: AuthenticatedSession,
  input: z.infer<typeof criterionInput>,
) {
  assertSessionCan(session, "qualification:manage");
  const parsed = criterionInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(assessmentCriteria)
      .where(
        eq(assessmentCriteria.curriculumModuleId, parsed.curriculumModuleId),
      );

    const [created] = await tx
      .insert(assessmentCriteria)
      .values({
        organisationId: session.organisationId,
        curriculumModuleId: parsed.curriculumModuleId,
        code: parsed.code,
        description: parsed.description,
        sortOrder: existing,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment_criterion.created",
      entityType: "assessment_criterion",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

export async function listCurriculumModules(
  session: AuthenticatedSession,
  qualificationId: string,
) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: curriculumModules.id,
        component: curriculumModules.component,
        code: curriculumModules.code,
        title: curriculumModules.title,
        credits: curriculumModules.credits,
        criterionCount: sql<number>`(
          select count(*)::int from assessment_criteria ac
          where ac.curriculum_module_id = curriculum_modules.id
        )`,
      })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId))
      .orderBy(asc(curriculumModules.sortOrder)),
  );
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export const courseInput = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(4000).optional(),
  curriculumModuleId: z.string().uuid().optional().nullable(),
  /**
   * The study unit this course delivers. A curriculum publishes modules; a
   * provider teaches study units, and this is what gives one somewhere to
   * live — its guide, its workbooks and its summative become one spine here.
   */
  studyUnitId: z.string().uuid().optional().nullable(),
  estimatedMinutes: z.coerce.number().int().min(0).max(100_000).optional(),
});

export async function createCourse(
  session: AuthenticatedSession,
  input: z.infer<typeof courseInput>,
) {
  assertSessionCan(session, "course:author");
  const parsed = courseInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(courses)
      .values({
        organisationId: session.organisationId,
        studyUnitId: parsed.studyUnitId ?? null,
        title: parsed.title,
        description: parsed.description ?? null,
        curriculumModuleId: parsed.curriculumModuleId || null,
        estimatedMinutes: parsed.estimatedMinutes ?? null,
        ownerId: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "course.created",
      entityType: "course",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

export async function listCourses(session: AuthenticatedSession) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: courses.id,
        title: courses.title,
        description: courses.description,
        status: courses.status,
        version: courses.version,
        curriculumModuleId: courses.curriculumModuleId,
        curriculumModuleCode: curriculumModules.code,
        curriculumComponent: curriculumModules.component,
        lessonCount: sql<number>`(
          select count(*)::int from lessons l
          join course_sections cs on cs.id = l.section_id
          where cs.course_id = courses.id
        )`,
        competencyCount: sql<number>`(
          select count(*)::int from course_competencies cc
          where cc.course_id = courses.id
        )`,
      })
      .from(courses)
      .leftJoin(
        curriculumModules,
        eq(curriculumModules.id, courses.curriculumModuleId),
      )
      .orderBy(asc(courses.title)),
  );
}

export async function getCourse(
  session: AuthenticatedSession,
  courseId: string,
) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx
      .select()
      .from(courses)
      .where(eq(courses.id, courseId));

    if (!course) {
      throw new AuthoringError("Course not found.", "not_found");
    }

    const sections = await tx
      .select()
      .from(courseSections)
      .where(eq(courseSections.courseId, courseId))
      .orderBy(asc(courseSections.sortOrder));

    const sectionIds = sections.map((section) => section.id);

    const courseLessons =
      sectionIds.length === 0
        ? []
        : await tx
            .select()
            .from(lessons)
            .where(inArray(lessons.sectionId, sectionIds))
            .orderBy(asc(lessons.sortOrder));

    const tagged = await tx
      .select({
        id: courseCompetencies.id,
        competencyId: competencies.id,
        code: competencies.code,
        name: competencies.name,
        proficiencyLevel: courseCompetencies.proficiencyLevel,
      })
      .from(courseCompetencies)
      .innerJoin(
        competencies,
        eq(competencies.id, courseCompetencies.competencyId),
      )
      .where(eq(courseCompetencies.courseId, courseId))
      .orderBy(asc(competencies.code));

    return {
      course,
      sections: sections.map((section) => ({
        ...section,
        lessons: courseLessons.filter(
          (lesson) => lesson.sectionId === section.id,
        ),
      })),
      competencies: tagged,
    };
  });
}

export const sectionInput = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).optional(),
});

export async function addSection(
  session: AuthenticatedSession,
  input: z.infer<typeof sectionInput>,
) {
  assertSessionCan(session, "course:author");
  const parsed = sectionInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    await assertCourseIsEditable(tx, parsed.courseId);

    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(courseSections)
      .where(eq(courseSections.courseId, parsed.courseId));

    const [created] = await tx
      .insert(courseSections)
      .values({
        organisationId: session.organisationId,
        courseId: parsed.courseId,
        title: parsed.title,
        description: parsed.description ?? null,
        sortOrder: existing,
      })
      .returning();

    return created;
  });
}

export const lessonInput = z.object({
  sectionId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  contentType: z
    .enum([
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
    ])
    .default("text"),
  body: z.string().trim().max(200_000).optional(),
  externalUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  durationMinutes: z.coerce.number().int().min(0).max(10_000).optional(),
  /** Internal Assessment Criteria this lesson covers. */
  criterionIds: z.array(z.string().uuid()).default([]),
});

export async function addLesson(
  session: AuthenticatedSession,
  // z.input, not z.infer: fields with defaults are optional for the caller
  // even though they are always present after parsing.
  input: z.input<typeof lessonInput>,
) {
  assertSessionCan(session, "course:author");
  const parsed = lessonInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [section] = await tx
      .select({ courseId: courseSections.courseId })
      .from(courseSections)
      .where(eq(courseSections.id, parsed.sectionId));

    if (!section) {
      throw new AuthoringError("Section not found.", "not_found");
    }

    await assertCourseIsEditable(tx, section.courseId);

    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(lessons)
      .where(eq(lessons.sectionId, parsed.sectionId));

    const [created] = await tx
      .insert(lessons)
      .values({
        organisationId: session.organisationId,
        sectionId: parsed.sectionId,
        title: parsed.title,
        contentType: parsed.contentType,
        body: parsed.body ?? null,
        externalUrl: parsed.externalUrl || null,
        durationMinutes: parsed.durationMinutes ?? null,
        sortOrder: existing,
      })
      .returning();

    if (parsed.criterionIds.length > 0) {
      await tx.insert(lessonCriteria).values(
        parsed.criterionIds.map((criterionId) => ({
          organisationId: session.organisationId,
          lessonId: created.id,
          criterionId,
        })),
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "lesson.created",
      entityType: "lesson",
      entityId: created.id,
      after: created,
    });

    return created;
  });
}

export async function tagCourseCompetency(
  session: AuthenticatedSession,
  courseId: string,
  competencyId: string,
  proficiencyLevel?: string,
) {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    await assertCourseIsEditable(tx, courseId);

    const [created] = await tx
      .insert(courseCompetencies)
      .values({
        organisationId: session.organisationId,
        courseId,
        competencyId,
        proficiencyLevel: proficiencyLevel ?? null,
      })
      .onConflictDoNothing()
      .returning();

    return created ?? null;
  });
}

export async function untagCourseCompetency(
  session: AuthenticatedSession,
  courseId: string,
  competencyId: string,
) {
  assertSessionCan(session, "course:author");

  await withTenant(session.organisationId, async (tx) => {
    await assertCourseIsEditable(tx, courseId);
    await tx
      .delete(courseCompetencies)
      .where(
        and(
          eq(courseCompetencies.courseId, courseId),
          eq(courseCompetencies.competencyId, competencyId),
        ),
      );
  });
}

/**
 * A published course is a historical record: learners have completed it and
 * their certificates refer to it. Editing it in place would rewrite what they
 * were assessed against, so changes go into a new version instead.
 */
async function assertCourseIsEditable(tx: TenantDatabase, courseId: string) {
  const [course] = await tx
    .select({ status: courses.status })
    .from(courses)
    .where(eq(courses.id, courseId));

  if (!course) {
    throw new AuthoringError("Course not found.", "not_found");
  }

  if (course.status === "published") {
    throw new AuthoringError(
      "This course is published. Create a new version to change it.",
      "invalid_state",
    );
  }

  if (course.status === "archived") {
    throw new AuthoringError("This course is archived.", "invalid_state");
  }
}

// ---------------------------------------------------------------------------
// The Learning Material Matrix, and publishing
// ---------------------------------------------------------------------------

export type CoverageReport = {
  /** Null when the course is not bound to an accredited curriculum module. */
  curriculumModuleId: string | null;
  criteria: {
    id: string;
    code: string;
    description: string;
    coveredByLessons: number;
  }[];
  uncovered: { id: string; code: string; description: string }[];
  /**
   * The KT / PA / AK / WA lines of the curriculum document: what has to be
   * taught, as opposed to what has to be assessed. Empty for a curriculum
   * captured without topics, and for tenants outside the occupational system.
   */
  topicElements: {
    id: string;
    code: string;
    description: string;
    kind: string;
    coveredByLessons: number;
  }[];
  uncoveredElements: { id: string; code: string; description: string }[];
  competencyCount: number;
  lessonCount: number;
};

/**
 * Reports which Internal Assessment Criteria have content behind them.
 *
 * Accreditation requires a provider to demonstrate that its material covers
 * the official curriculum. Working that out by hand across a qualification is
 * exactly the sort of task that gets signed off without really being checked,
 * so the platform computes it.
 */
export async function coverageReport(
  session: AuthenticatedSession,
  courseId: string,
): Promise<CoverageReport> {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx
      .select({
        id: courses.id,
        curriculumModuleId: courses.curriculumModuleId,
      })
      .from(courses)
      .where(eq(courses.id, courseId));

    if (!course) {
      throw new AuthoringError("Course not found.", "not_found");
    }

    const [{ lessonCount }] = await tx
      .select({ lessonCount: count() })
      .from(lessons)
      .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
      .where(eq(courseSections.courseId, courseId));

    const [{ competencyCount }] = await tx
      .select({ competencyCount: count() })
      .from(courseCompetencies)
      .where(eq(courseCompetencies.courseId, courseId));

    if (!course.curriculumModuleId) {
      return {
        curriculumModuleId: null,
        criteria: [],
        uncovered: [],
        topicElements: [],
        uncoveredElements: [],
        competencyCount,
        lessonCount,
      };
    }

    const criteria = await tx
      .select({
        id: assessmentCriteria.id,
        code: assessmentCriteria.code,
        description: assessmentCriteria.description,
        // Only lessons belonging to this course count towards its coverage.
        // A lesson in a different course on the same curriculum module must
        // not make this one look covered.
        coveredByLessons: sql<number>`(
          select count(*)::int from lesson_criteria lc
          join lessons l on l.id = lc.lesson_id
          join course_sections cs on cs.id = l.section_id
          where lc.criterion_id = assessment_criteria.id
            and cs.course_id = ${courseId}
        )`,
      })
      .from(assessmentCriteria)
      .where(
        eq(assessmentCriteria.curriculumModuleId, course.curriculumModuleId),
      )
      .orderBy(asc(assessmentCriteria.sortOrder));

    const topicElements = await tx
      .select({
        id: curriculumTopicElements.id,
        code: curriculumTopicElements.code,
        description: curriculumTopicElements.description,
        kind: curriculumTopicElements.kind,
        coveredByLessons: sql<number>`(
          select count(*)::int from lesson_topic_elements lte
          join lessons l on l.id = lte.lesson_id
          join course_sections cs on cs.id = l.section_id
          where lte.topic_element_id = curriculum_topic_elements.id
            and cs.course_id = ${courseId}
        )`,
      })
      .from(curriculumTopicElements)
      .innerJoin(
        curriculumTopics,
        eq(curriculumTopics.id, curriculumTopicElements.topicId),
      )
      .where(eq(curriculumTopics.curriculumModuleId, course.curriculumModuleId))
      .orderBy(
        asc(curriculumTopics.sortOrder),
        asc(curriculumTopicElements.sortOrder),
      );

    return {
      curriculumModuleId: course.curriculumModuleId,
      criteria,
      uncovered: criteria
        .filter((criterion) => criterion.coveredByLessons === 0)
        .map(({ id, code, description }) => ({ id, code, description })),
      topicElements,
      uncoveredElements: topicElements
        .filter((element) => element.coveredByLessons === 0)
        .map(({ id, code, description }) => ({ id, code, description })),
      competencyCount,
      lessonCount,
    };
  });
}

export type PublishRefusal = {
  ok: false;
  reasons: string[];
  report: CoverageReport;
};

export type PublishSuccess = {
  ok: true;
  report: CoverageReport;
};

/**
 * Publishes a course, or explains precisely why it cannot be.
 *
 * Refusing here rather than warning is deliberate. A gap that only produces a
 * warning gets published anyway, and is then discovered by an external
 * verifier long after the cohort has been assessed against it.
 */
export async function publishCourse(
  session: AuthenticatedSession,
  courseId: string,
): Promise<PublishSuccess | PublishRefusal> {
  assertSessionCan(session, "course:publish");

  const report = await coverageReport(session, courseId);
  const reasons: string[] = [];

  if (report.lessonCount === 0) {
    reasons.push("The course has no lessons yet.");
  }

  if (report.competencyCount === 0) {
    reasons.push(
      "The course is not tagged to any competency, so completing it could not be reported as capability coverage.",
    );
  }

  if (report.uncovered.length > 0) {
    const one = report.uncovered.length === 1;
    reasons.push(
      `${report.uncovered.length} assessment ${
        one ? "criterion has" : "criteria have"
      } no lesson covering ${one ? "it" : "them"}: ${report.uncovered
        .map((criterion) => criterion.code)
        .join(", ")}.`,
    );
  }

  // Separate from the criteria check, and not merged with it. "Nothing teaches
  // this" and "nothing assesses this" are different failures with different
  // fixes, and a verifier asks about them separately.
  if (report.uncoveredElements.length > 0) {
    const one = report.uncoveredElements.length === 1;
    reasons.push(
      `${report.uncoveredElements.length} curriculum ${
        one ? "topic element has" : "topic elements have"
      } no lesson teaching ${one ? "it" : "them"}: ${report.uncoveredElements
        .map((element) => element.code)
        .join(", ")}.`,
    );
  }

  if (reasons.length > 0) {
    return { ok: false, reasons, report };
  }

  await withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select({ status: courses.status })
      .from(courses)
      .where(eq(courses.id, courseId));

    if (before?.status === "published") {
      throw new AuthoringError("This course is already published.", "invalid_state");
    }

    await tx
      .update(courses)
      .set({
        status: "published",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(courses.id, courseId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "course.published",
      entityType: "course",
      entityId: courseId,
      before: { status: before?.status },
      after: {
        status: "published",
        criteriaCovered: report.criteria.length,
        competenciesTagged: report.competencyCount,
      },
    });
  });

  return { ok: true, report };
}

/**
 * Opens a new draft version of a published course. The published one is left
 * exactly as it is, so a learner who finished it keeps an accurate record of
 * what they completed.
 */
export async function createNewVersion(
  session: AuthenticatedSession,
  courseId: string,
) {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(courses)
      .where(eq(courses.id, courseId));

    if (!existing) {
      throw new AuthoringError("Course not found.", "not_found");
    }

    if (existing.status !== "published") {
      throw new AuthoringError(
        "Only a published course needs a new version; this one can be edited directly.",
        "invalid_state",
      );
    }

    const [draft] = await tx
      .insert(courses)
      .values({
        organisationId: session.organisationId,
        title: existing.title,
        description: existing.description,
        curriculumModuleId: existing.curriculumModuleId,
        estimatedMinutes: existing.estimatedMinutes,
        ownerId: session.userId,
        version: existing.version + 1,
        supersedesCourseId: existing.id,
        status: "draft",
      })
      .returning();

    // Carry the competency tags forward; the content is copied by the author.
    const tags = await tx
      .select({ competencyId: courseCompetencies.competencyId })
      .from(courseCompetencies)
      .where(eq(courseCompetencies.courseId, courseId));

    if (tags.length > 0) {
      await tx.insert(courseCompetencies).values(
        tags.map((tag) => ({
          organisationId: session.organisationId,
          courseId: draft.id,
          competencyId: tag.competencyId,
        })),
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "course.version_created",
      entityType: "course",
      entityId: draft.id,
      after: { version: draft.version, supersedes: courseId },
    });

    return draft;
  });
}

export async function listCompetencies(session: AuthenticatedSession) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: competencies.id,
        code: competencies.code,
        name: competencies.name,
        proficiencyLevels: competencies.proficiencyLevels,
      })
      .from(competencies)
      .orderBy(asc(competencies.code)),
  );
}
