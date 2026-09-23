import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentPapers,
  assessments,
  courseSteps,
  courses,
  curriculumModules,
  exitLevelOutcomes,
  lessons,
  programmeDocuments,
  qualifications,
  studyUnits,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * A whole qualification, as a learner will meet it, for the person who built it.
 *
 * Roland, 19 September: "Workbooks and assessments are supposed to be 'Built
 * into' the LMS ... How do I see it (outside of being a learner)?" The answer
 * then was /papers/[id]/preview, which covers one paper. Job sheet 2.1 is the
 * rest of it: the qualification walked end to end, in the order somebody
 * enrolled on it would walk it.
 *
 * Seeing it any other way means enrolling on it. `/learn/[id]` is keyed on an
 * enrolment, computes gating against a real person and records that steps were
 * opened, so an administrator looking at their own programme would be sitting
 * it. This writes nothing, starts nothing and gates nothing.
 *
 * What makes it worth building rather than decorative is the second half:
 * **it reports what a learner would not find.** A study unit with no course
 * behind it, a step pointing at a deleted lesson, an assessment still in draft
 * - each is invisible from the authoring screens, because each of those shows
 * what exists rather than what is reachable. This shows the holes, which is
 * what somebody testing a programme before a cohort starts actually needs.
 */

export class PreviewError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found",
  ) {
    super(message);
    this.name = "PreviewError";
  }
}

export type PreviewStep = {
  id: string;
  kind: string;
  title: string;
  guidance: string | null;
  optional: boolean;
  /** Whether a learner reaching this step would find something to do. */
  ready: boolean;
  /** Why not, in words, where it is not ready. */
  note: string | null;
  /** Where the author can look at it as the learner will see it. */
  href: string | null;
};

export type PreviewUnit = {
  id: string;
  code: string;
  title: string;
  credits: number | null;
  outcome: string | null;
  courseId: string | null;
  steps: PreviewStep[];
  /** What a learner would not find in this unit. */
  gaps: string[];
};

export type QualificationPreview = {
  qualification: {
    id: string;
    title: string;
    saqaId: string | null;
    curriculumCode: string | null;
    nqfLevel: number | null;
    totalCredits: number | null;
  };
  units: PreviewUnit[];
  /** What is missing across the whole qualification. */
  gaps: string[];
  counts: { units: number; steps: number; ready: number };
};

export async function previewQualification(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<QualificationPreview> {
  // The people who build a programme, which is administrators and
  // facilitators. Not assessors, whose business is a learner's evidence
  // rather than the shape of the programme.
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select({
        id: qualifications.id,
        title: qualifications.title,
        saqaId: qualifications.saqaId,
        curriculumCode: qualifications.curriculumCode,
        nqfLevel: qualifications.nqfLevel,
        totalCredits: qualifications.totalCredits,
      })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!qualification) {
      throw new PreviewError("No such qualification.", "not_found");
    }

    const units = await tx
      .select({
        id: studyUnits.id,
        code: studyUnits.code,
        title: studyUnits.title,
        credits: studyUnits.credits,
        outcome: exitLevelOutcomes.description,
      })
      .from(studyUnits)
      .leftJoin(
        exitLevelOutcomes,
        eq(exitLevelOutcomes.id, studyUnits.exitLevelOutcomeId),
      )
      .where(eq(studyUnits.qualificationId, qualificationId))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));

    const gaps: string[] = [];

    if (units.length === 0) {
      gaps.push(
        "This qualification has no study units, so there is nothing for a learner to walk through. Study units come from the alignment document.",
      );
      return {
        qualification,
        units: [],
        gaps,
        counts: { units: 0, steps: 0, ready: 0 },
      };
    }

    // One pass for the courses behind every unit, rather than a query each.
    const unitIds = units.map((unit) => unit.id);
    const unitCourses = await tx
      .select({ id: courses.id, studyUnitId: courses.studyUnitId })
      .from(courses)
      .where(inArray(courses.studyUnitId, unitIds));

    const courseByUnit = new Map(
      unitCourses.flatMap((row) =>
        row.studyUnitId ? [[row.studyUnitId, row.id] as const] : [],
      ),
    );

    const built: PreviewUnit[] = [];
    let stepCount = 0;
    let readyCount = 0;

    for (const unit of units) {
      const courseId = courseByUnit.get(unit.id) ?? null;
      const unitGaps: string[] = [];

      if (!courseId) {
        unitGaps.push(
          "Nothing has been built for this study unit yet, so a learner enrolled on the qualification would find it empty.",
        );
        built.push({ ...unit, courseId: null, steps: [], gaps: unitGaps });
        continue;
      }

      const steps = await stepsOf(tx, courseId);
      stepCount += steps.length;
      readyCount += steps.filter((step) => step.ready).length;

      if (steps.length === 0) {
        unitGaps.push(
          "This study unit has a course with no steps in it, so a learner would open it and find nothing to do.",
        );
      }

      for (const step of steps) {
        if (!step.ready && step.note) unitGaps.push(`${step.title}: ${step.note}`);
      }

      built.push({ ...unit, courseId, steps, gaps: unitGaps });
    }

    const emptyUnits = built.filter((unit) => unit.steps.length === 0).length;
    if (emptyUnits > 0) {
      gaps.push(
        `${emptyUnits} of ${built.length} study units have nothing in them yet.`,
      );
    }
    if (stepCount > 0 && readyCount < stepCount) {
      gaps.push(
        `${stepCount - readyCount} of ${stepCount} steps would not present anything to a learner today.`,
      );
    }

    return {
      qualification,
      units: built,
      gaps,
      counts: { units: built.length, steps: stepCount, ready: readyCount },
    };
  });
}

/**
 * A course's steps, in order, with what a learner would find behind each.
 *
 * The spine's own reader computes gating and progress against a named learner,
 * which is exactly what a preview must not do. This asks the simpler question:
 * is there anything there at all.
 */
async function stepsOf(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  courseId: string,
): Promise<PreviewStep[]> {
  const rows = await tx
    .select({
      id: courseSteps.id,
      kind: courseSteps.kind,
      title: courseSteps.title,
      guidance: courseSteps.guidance,
      optional: courseSteps.optional,
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

  // The published paper behind each assessment step, so the preview can offer
  // the screen that already renders one properly.
  const assessmentIds = rows.flatMap((row) =>
    row.assessmentId ? [row.assessmentId] : [],
  );

  const papers = assessmentIds.length
    ? await tx
        .select({
          id: assessmentPapers.id,
          assessmentId: assessmentPapers.assessmentId,
        })
        .from(assessmentPapers)
        .where(
          and(
            inArray(assessmentPapers.assessmentId, assessmentIds),
            eq(assessmentPapers.status, "published"),
          ),
        )
        .orderBy(asc(assessmentPapers.sortOrder))
    : [];

  const paperFor = new Map(
    papers.map((paper) => [paper.assessmentId, paper.id] as const),
  );

  return rows.map((row) => {
    const fallback =
      row.lessonTitle ??
      row.documentTitle ??
      row.moduleTitle ??
      row.assessmentTitle ??
      "Untitled step";

    const base = {
      id: row.id,
      kind: row.kind as string,
      title: row.title ?? fallback,
      guidance: row.guidance,
      // Stored as 0 or 1, read as a boolean, exactly as lib/spine.ts does.
      optional: row.optional === 1,
    };

    /*
     * A step whose target has gone.
     *
     * The foreign keys cascade, so this should not happen; it is checked
     * because the whole point of this screen is to find what a learner would
     * hit, and "should not happen" is not the same as "cannot".
     */
    const missingTarget =
      (row.kind === "lesson" && !row.lessonTitle) ||
      (row.kind === "document" && !row.documentTitle) ||
      (row.kind === "workplace" && !row.moduleTitle) ||
      (row.kind === "assessment" && !row.assessmentTitle);

    if (missingTarget) {
      return {
        ...base,
        ready: false,
        note: "points at something that is no longer there.",
        href: null,
      };
    }

    if (row.kind === "assessment") {
      const paperId = row.assessmentId
        ? (paperFor.get(row.assessmentId) ?? null)
        : null;

      if (row.assessmentStatus !== "published") {
        return {
          ...base,
          ready: false,
          note: "is still a draft, so a learner is not offered it.",
          href: paperId ? `/papers/${paperId}/preview` : null,
        };
      }

      return {
        ...base,
        ready: true,
        note: null,
        // A published assessment with no paper is a flat quiz, which has no
        // paper screen to show. It is still ready.
        href: paperId ? `/papers/${paperId}/preview` : null,
      };
    }

    return { ...base, ready: true, note: null, href: null };
  });
}
