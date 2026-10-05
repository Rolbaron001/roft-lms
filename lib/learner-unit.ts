import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  courseSteps,
  courses,
  curriculumModules,
  curriculumTopics,
  enrolments,
  exitLevelOutcomes,
  libraryItems,
  libraryLinks,
  programmeDocuments,
  qualifications,
  studyUnitModules,
  studyUnits,
} from "@/db/schema";
import { can } from "./rbac";
import type { AuthenticatedSession } from "./session";
import { RESTRICTED_TO_ASSESSORS, type DocumentKind } from "./programme-documents";
import { getObject } from "./storage";
import { detectMedia } from "./media";
import { UploadError, type ServableFile } from "./uploads";
import { servable } from "./library";
import { stepsForLearner, type StepView } from "./spine";

/**
 * What a learner meets on a study unit's page (Roland's design of 5 October
 * 2026): what the unit is about and what they will learn, the theory guide
 * to read in the page or download, the library material the unit uses, and
 * its workbooks and assessments, each released by the cohort.
 *
 * The summary is drawn from what the platform already holds about the unit,
 * which is what the theory guide's own cover page states: its exit level
 * outcome, its modules and their topics. Nothing is invented for it.
 */

export type UnitOverview = {
  qualification: { id: string; title: string; saqaId: string | null; nqfLevel: number | null; totalCredits: number | null };
  unit: { id: string; code: string; title: string; position: number; of: number };
  outcome: string | null;
  modules: { code: string; title: string; credits: number | null; component: string }[];
  topics: string[];
};

class LearnerUnitError extends UploadError {}

/** The enrolment, if the person may look at it: their own, or staff who read all. */
async function enrolmentFor(session: AuthenticatedSession, enrolmentId: string) {
  const enrolment = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({ id: enrolments.id, userId: enrolments.userId, courseId: enrolments.courseId, studyUnitId: courses.studyUnitId })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(eq(enrolments.id, enrolmentId));
    return row;
  });
  if (!enrolment) throw new LearnerUnitError("Not found.", "not_found");
  if (enrolment.userId !== session.userId && !can(session, "enrolment:read_all")) {
    throw new LearnerUnitError("That belongs to someone else.", "not_permitted");
  }
  return enrolment;
}

/** The study unit behind an enrolment, or null when its course is not one. */
export async function unitOverview(session: AuthenticatedSession, studyUnitId: string): Promise<UnitOverview | null> {
  return withTenant(session.organisationId, async (tx) => {
    const [unit] = await tx
      .select({ id: studyUnits.id, code: studyUnits.code, title: studyUnits.title, qualificationId: studyUnits.qualificationId, outcomeId: studyUnits.exitLevelOutcomeId })
      .from(studyUnits)
      .where(eq(studyUnits.id, studyUnitId));
    if (!unit) return null;
    const [qualification] = await tx
      .select({ id: qualifications.id, title: qualifications.title, saqaId: qualifications.saqaId, nqfLevel: qualifications.nqfLevel, totalCredits: qualifications.totalCredits })
      .from(qualifications)
      .where(eq(qualifications.id, unit.qualificationId));
    const siblings = await tx
      .select({ id: studyUnits.id })
      .from(studyUnits)
      .where(eq(studyUnits.qualificationId, unit.qualificationId))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));
    const [outcome] = unit.outcomeId
      ? await tx.select({ description: exitLevelOutcomes.description }).from(exitLevelOutcomes).where(eq(exitLevelOutcomes.id, unit.outcomeId))
      : [];
    const modules = await tx
      .select({ id: curriculumModules.id, code: curriculumModules.code, title: curriculumModules.title, credits: curriculumModules.credits, component: curriculumModules.component })
      .from(studyUnitModules)
      .innerJoin(curriculumModules, eq(curriculumModules.id, studyUnitModules.curriculumModuleId))
      .where(eq(studyUnitModules.studyUnitId, unit.id))
      .orderBy(asc(curriculumModules.sortOrder), asc(curriculumModules.code));
    const knowledge = modules.filter((one) => one.component === "knowledge").map((one) => one.id);
    const topics = knowledge.length
      ? await tx
          .select({ title: curriculumTopics.title, moduleId: curriculumTopics.curriculumModuleId })
          .from(curriculumTopics)
          .where(inArray(curriculumTopics.curriculumModuleId, knowledge))
          .orderBy(asc(curriculumTopics.sortOrder), asc(curriculumTopics.code))
      : [];
    return {
      qualification: qualification ?? { id: unit.qualificationId, title: "", saqaId: null, nqfLevel: null, totalCredits: null },
      unit: { id: unit.id, code: unit.code, title: unit.title, position: siblings.findIndex((one) => one.id === unit.id) + 1, of: siblings.length },
      outcome: outcome?.description ?? null,
      modules: modules.map(({ code, title, credits, component }) => ({ code, title, credits, component })),
      topics: topics.map((topic) => topic.title),
    };
  });
}

export type LearnerMaterial = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  open: boolean;
  /** Why not, where it is not open yet. */
  waiting: string | null;
};

/**
 * Whether something released "with" a step is open: with that step, or,
 * released with the unit itself, with the unit's first step. A unit with no
 * steps holds nothing back.
 */
function openWith(steps: StepView[], stepId: string | null): { open: boolean; waiting: string | null } {
  const step = stepId ? steps.find((one) => one.id === stepId) : steps[0];
  if (!step) return { open: true, waiting: null };
  return { open: step.open, waiting: step.open ? null : (step.blockedBy[0] ?? null) };
}

/** The library items a study unit uses, each with whether this learner may open it. */
export async function learnerMaterial(
  session: AuthenticatedSession,
  studyUnitId: string,
  steps: StepView[],
): Promise<LearnerMaterial[]> {
  const rows = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: libraryItems.id,
        title: libraryItems.title,
        description: libraryItems.description,
        kind: libraryItems.kind,
        mimeType: libraryItems.mimeType,
        sizeBytes: libraryItems.sizeBytes,
        releaseWithStepId: libraryLinks.releaseWithStepId,
      })
      .from(libraryLinks)
      .innerJoin(libraryItems, eq(libraryItems.id, libraryLinks.itemId))
      .where(eq(libraryLinks.studyUnitId, studyUnitId))
      .orderBy(asc(libraryLinks.sortOrder), asc(libraryLinks.createdAt)),
  );
  return rows.map(({ releaseWithStepId, ...row }) => ({ ...row, ...openWith(steps, releaseWithStepId) }));
}

/**
 * A theory guide or other document on the learner's path, for reading or
 * downloading. Refused unless the document is a step on this enrolment's
 * course, the step is open to the enrolment's learner, and it is not one
 * kept from learners.
 */
export async function readLearnerDocument(
  session: AuthenticatedSession,
  enrolmentId: string,
  documentId: string,
): Promise<ServableFile> {
  const enrolment = await enrolmentFor(session, enrolmentId);
  const document = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({ stepId: courseSteps.id, kind: programmeDocuments.kind, storageKey: programmeDocuments.storageKey, filename: programmeDocuments.filename })
      .from(courseSteps)
      .innerJoin(programmeDocuments, eq(programmeDocuments.id, courseSteps.programmeDocumentId))
      .where(and(eq(courseSteps.courseId, enrolment.courseId!), eq(courseSteps.programmeDocumentId, documentId)));
    return row;
  });
  if (!document || RESTRICTED_TO_ASSESSORS.has(document.kind as DocumentKind)) throw new LearnerUnitError("Not found.", "not_found");
  const steps = await stepsForLearner(session, enrolment.courseId!, enrolment.userId);
  if (!steps.find((step) => step.id === document.stepId)?.open) throw new LearnerUnitError("That is not open yet.", "not_permitted");
  const bytes = await getObject(document.storageKey);
  const detected = detectMedia(bytes, document.filename);
  return {
    bytes,
    mimeType: detected.ok ? detected.mimeType : "application/octet-stream",
    filename: document.filename,
    safeToEmbed: detected.ok ? detected.safeToEmbed : false,
  };
}

/** A library item on the learner's study unit, once it is released to them. */
export async function readLearnerLibraryItem(
  session: AuthenticatedSession,
  enrolmentId: string,
  itemId: string,
): Promise<ServableFile> {
  const enrolment = await enrolmentFor(session, enrolmentId);
  if (!enrolment.studyUnitId) throw new LearnerUnitError("Not found.", "not_found");
  const link = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({ releaseWithStepId: libraryLinks.releaseWithStepId, storageKey: libraryItems.storageKey, filename: libraryItems.filename })
      .from(libraryLinks)
      .innerJoin(libraryItems, eq(libraryItems.id, libraryLinks.itemId))
      .where(and(eq(libraryLinks.itemId, itemId), eq(libraryLinks.studyUnitId, enrolment.studyUnitId!)));
    return row;
  });
  if (!link) throw new LearnerUnitError("Not found.", "not_found");
  const steps = await stepsForLearner(session, enrolment.courseId!, enrolment.userId);
  if (!openWith(steps, link.releaseWithStepId).open) throw new LearnerUnitError("That is not open yet.", "not_permitted");
  return servable(link);
}
