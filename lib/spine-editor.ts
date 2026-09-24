import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentPapers,
  assessments,
  courseSections,
  courseStepPrerequisites,
  courseSteps,
  courses,
  curriculumModules,
  lessons,
  programmeDocuments,
  studyUnits,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import {
  RESTRICTED_TO_ASSESSORS,
  type DocumentKind,
} from "./programme-documents";

/**
 * Reading a course's spine for the person building it.
 *
 * `lib/spine.ts` could already add a step, reorder one, remove one and gate
 * one, and every bit of it was tested. Nothing called `addStep` outside the
 * test files, so no screen in the platform could put a single thing in front
 * of a learner.
 *
 * Found on 23 September by the qualification preview built for job sheet 2.1:
 * four assessments captured into 121151, every one of them a draft with a
 * draft paper and no place on any spine, so nothing a learner enrolled on the
 * programme would ever meet. The machinery was complete and unreachable, which
 * is the same shape as the paper preview in September.
 *
 * This module is the reading half of the screen that closes it. The writing
 * half is already in lib/spine.ts and is not duplicated here.
 */

export type SpineStep = {
  id: string;
  kind: string;
  /** What the step is called, falling back to whatever it points at. */
  title: string;
  /** The target's own name, where the step overrides it with its own title. */
  targetTitle: string | null;
  guidance: string | null;
  optional: boolean;
  release: string;
  sequentialRule: string;
  sortOrder: number;
  /** Whether a learner reaching it would find anything. */
  ready: boolean;
  note: string | null;
  /** Steps that have to be satisfied first, in words. */
  prerequisites: { requiredStepId: string; rule: string }[];
};

export type StepChoice = {
  kind: "lesson" | "assessment" | "document" | "workplace";
  id: string;
  title: string;
  /** What it is, for the reader: "Summative", "Theory guide", and so on. */
  detail: string | null;
  /** Said where adding it would not yet reach a learner. */
  warning: string | null;
};

export type CourseSpine = {
  course: { id: string; title: string; studyUnitId: string | null };
  studyUnit: { id: string; code: string; title: string } | null;
  steps: SpineStep[];
  /** What is held against this course and is not on the spine. */
  choices: StepChoice[];
};

export class SpineEditorError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found",
  ) {
    super(message);
    this.name = "SpineEditorError";
  }
}

export async function courseSpine(
  session: AuthenticatedSession,
  courseId: string,
): Promise<CourseSpine> {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx
      .select({
        id: courses.id,
        title: courses.title,
        studyUnitId: courses.studyUnitId,
      })
      .from(courses)
      .where(eq(courses.id, courseId));

    if (!course) throw new SpineEditorError("No such course.", "not_found");

    const [unit] = course.studyUnitId
      ? await tx
          .select({
            id: studyUnits.id,
            code: studyUnits.code,
            title: studyUnits.title,
            qualificationId: studyUnits.qualificationId,
          })
          .from(studyUnits)
          .where(eq(studyUnits.id, course.studyUnitId))
      : [];

    const steps = await loadSpine(tx, courseId);
    const taken = new Set(
      steps.flatMap((step) => (step.targetId ? [step.targetId] : [])),
    );

    return {
      course,
      studyUnit: unit
        ? { id: unit.id, code: unit.code, title: unit.title }
        : null,
      steps: steps.map((step) => {
        const withoutTarget = { ...step };
        delete (withoutTarget as { targetId?: string | null }).targetId;
        return withoutTarget as SpineStep;
      }),
      choices: await offerableSteps(
        tx,
        courseId,
        unit?.qualificationId ?? null,
        taken,
      ),
    };
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

async function loadSpine(
  tx: Tx,
  courseId: string,
): Promise<(SpineStep & { targetId: string | null })[]> {
  const rows = await tx
    .select({
      id: courseSteps.id,
      kind: courseSteps.kind,
      title: courseSteps.title,
      guidance: courseSteps.guidance,
      optional: courseSteps.optional,
      release: courseSteps.release,
      sequentialRule: courseSteps.sequentialRule,
      sortOrder: courseSteps.sortOrder,
      lessonId: courseSteps.lessonId,
      assessmentId: courseSteps.assessmentId,
      programmeDocumentId: courseSteps.programmeDocumentId,
      curriculumModuleId: courseSteps.curriculumModuleId,
      lessonTitle: lessons.title,
      documentTitle: programmeDocuments.title,
      moduleTitle: curriculumModules.title,
      assessmentTitle: assessments.title,
      assessmentStatus: assessments.status,
    })
    .from(courseSteps)
    .leftJoin(lessons, eq(lessons.id, courseSteps.lessonId))
    .leftJoin(
      programmeDocuments,
      eq(programmeDocuments.id, courseSteps.programmeDocumentId),
    )
    .leftJoin(
      curriculumModules,
      eq(curriculumModules.id, courseSteps.curriculumModuleId),
    )
    .leftJoin(assessments, eq(assessments.id, courseSteps.assessmentId))
    .where(eq(courseSteps.courseId, courseId))
    .orderBy(asc(courseSteps.sortOrder), asc(courseSteps.createdAt));

  if (rows.length === 0) return [];

  const gates = await tx
    .select({
      stepId: courseStepPrerequisites.stepId,
      requiredStepId: courseStepPrerequisites.requiredStepId,
      rule: courseStepPrerequisites.rule,
    })
    .from(courseStepPrerequisites)
    .where(
      inArray(
        courseStepPrerequisites.stepId,
        rows.map((row) => row.id),
      ),
    );

  return rows.map((row) => {
    const targetTitle =
      row.lessonTitle ??
      row.documentTitle ??
      row.moduleTitle ??
      row.assessmentTitle ??
      null;

    const targetId =
      row.lessonId ??
      row.assessmentId ??
      row.programmeDocumentId ??
      row.curriculumModuleId ??
      null;

    const missing = targetTitle === null;
    const draft = row.kind === "assessment" && row.assessmentStatus !== "published";

    return {
      id: row.id,
      kind: row.kind as string,
      title: row.title ?? targetTitle ?? "Untitled step",
      targetTitle: row.title ? targetTitle : null,
      guidance: row.guidance,
      optional: row.optional === 1,
      release: row.release as string,
      sequentialRule: row.sequentialRule as string,
      sortOrder: row.sortOrder,
      ready: !missing && !draft,
      note: missing
        ? "points at something that is no longer there."
        : draft
          ? "the assessment is still a draft, so a learner is not offered it."
          : null,
      prerequisites: gates
        .filter((gate) => gate.stepId === row.id)
        .map((gate) => ({
          requiredStepId: gate.requiredStepId,
          rule: gate.rule as string,
        })),
      targetId,
    };
  });
}

/**
 * Everything held against this course that could become a step, less whatever
 * is already one.
 *
 * Offering something twice is the mistake this prevents: a workbook added to
 * the spine and then offered again reads as though the first one did not take.
 */
async function offerableSteps(
  tx: Tx,
  courseId: string,
  qualificationId: string | null,
  taken: Set<string>,
): Promise<StepChoice[]> {
  const choices: StepChoice[] = [];

  // --- lessons, which hang off the course's own sections -------------------
  const courseLessons = await tx
    .select({ id: lessons.id, title: lessons.title, kind: lessons.contentType })
    .from(lessons)
    .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
    .where(eq(courseSections.courseId, courseId))
    .orderBy(asc(courseSections.sortOrder), asc(lessons.sortOrder));

  for (const lesson of courseLessons) {
    if (taken.has(lesson.id)) continue;
    choices.push({
      kind: "lesson",
      id: lesson.id,
      title: lesson.title,
      detail: lesson.kind as string,
      warning: null,
    });
  }

  // --- assessments ---------------------------------------------------------
  const courseAssessments = await tx
    .select({
      id: assessments.id,
      title: assessments.title,
      purpose: assessments.purpose,
      status: assessments.status,
    })
    .from(assessments)
    .where(eq(assessments.courseId, courseId))
    .orderBy(asc(assessments.title));

  const papers = courseAssessments.length
    ? await tx
        .select({
          assessmentId: assessmentPapers.assessmentId,
          status: assessmentPapers.status,
        })
        .from(assessmentPapers)
        .where(
          inArray(
            assessmentPapers.assessmentId,
            courseAssessments.map((one) => one.id),
          ),
        )
    : [];

  for (const assessment of courseAssessments) {
    if (taken.has(assessment.id)) continue;

    const own = papers.filter((paper) => paper.assessmentId === assessment.id);
    const published = own.filter((paper) => paper.status === "published");

    /*
     * Added while still a draft, deliberately.
     *
     * Refusing would mean building the spine only after everything on it is
     * finished, which is the wrong order: the shape of a programme is decided
     * before its last paper is proofread. The warning says what the learner
     * would see today, and the preview says it again.
     */
    const warning =
      assessment.status !== "published"
        ? "This is still a draft. It can go on the spine now, and a learner will not be offered it until it is published."
        : own.length > 0 && published.length === 0
          ? "Published, but none of its papers are. A learner would find nothing to answer."
          : null;

    choices.push({
      kind: "assessment",
      id: assessment.id,
      title: assessment.title,
      detail:
        assessment.purpose === "summative"
          ? "Summative"
          : assessment.purpose === "formative"
            ? "Formative"
            : (assessment.purpose as string),
      warning,
    });
  }

  // --- documents, from the course and from what it delivers ----------------
  const documents = await tx
    .select({
      id: programmeDocuments.id,
      title: programmeDocuments.title,
      kind: programmeDocuments.kind,
    })
    .from(programmeDocuments)
    .where(
      qualificationId
        ? or(
            eq(programmeDocuments.courseId, courseId),
            eq(programmeDocuments.qualificationId, qualificationId),
          )
        : eq(programmeDocuments.courseId, courseId),
    )
    .orderBy(asc(programmeDocuments.title));

  for (const document of documents) {
    if (taken.has(document.id)) continue;

    /*
     * A memorandum is never a step.
     *
     * A document step hands the file to whoever reaches it, and the whole
     * point of a spine is that a learner reaches it. The library already
     * keeps these three from learners on the documents screen, and offering
     * them here would have walked straight past that: the editor's first run
     * offered "CA 121151 SU1 WB1 AG", the answer guide to a workbook.
     *
     * A summative assessment document is on the same list for a different
     * reason: a learner sits it as a captured paper, through the platform,
     * rather than downloading the Word file it came from.
     */
    if (RESTRICTED_TO_ASSESSORS.has(document.kind as DocumentKind)) continue;

    choices.push({
      kind: "document",
      id: document.id,
      title: document.title,
      detail: (document.kind as string).replace(/_/g, " "),
      warning: null,
    });
  }

  // --- work experience modules ---------------------------------------------
  //
  // Only the workplace ones. A knowledge module is taught and assessed; a work
  // experience module is proved by a logbook a coach signs, which is what a
  // workplace step is for.
  if (qualificationId) {
    const workplace = await tx
      .select({
        id: curriculumModules.id,
        code: curriculumModules.code,
        title: curriculumModules.title,
      })
      .from(curriculumModules)
      .where(
        and(
          eq(curriculumModules.qualificationId, qualificationId),
          eq(curriculumModules.component, "workplace"),
        ),
      )
      .orderBy(asc(curriculumModules.code));

    for (const unit of workplace) {
      if (taken.has(unit.id)) continue;
      choices.push({
        kind: "workplace",
        id: unit.id,
        title: `${unit.code} ${unit.title}`,
        detail: "Work experience",
        warning: null,
      });
    }
  }

  return choices;
}

/**
 * Courses with no spine, for the screen that offers to go and build one.
 *
 * Unused by the editor itself; it is what lets a study unit say "nothing has
 * been built here" and link somewhere useful rather than just stating it.
 */
export async function coursesWithoutSteps(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<{ id: string; title: string; studyUnitCode: string | null }[]> {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: courses.id,
        title: courses.title,
        studyUnitCode: studyUnits.code,
      })
      .from(courses)
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .leftJoin(courseSteps, eq(courseSteps.courseId, courses.id))
      .where(
        and(
          eq(studyUnits.qualificationId, qualificationId),
          isNull(courseSteps.id),
        ),
      )
      .orderBy(asc(studyUnits.sortOrder)),
  );
}
