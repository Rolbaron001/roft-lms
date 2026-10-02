import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentCriteria,
  assessmentItemCriteria,
  assessmentItems,
  assessmentPapers,
  assessmentSections,
  assessments,
  captureJobs,
  courseSteps,
  courses,
  curriculumModules,
  curriculumTopics,
  programmeDocuments,
  studyUnitModules,
  studyUnits,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { createAssessment, publishAssessment } from "./assessment";
import { coursePublishChecks, publishCourse } from "./authoring";
import { commitCapture, proposeCapture } from "./capture";
import type { ParsedPaper } from "./capture-parse";
import { capturableDocuments, courseForStudyUnit, versionOf } from "./capture-from-documents";
import { resolvePaperCriteria, type CriterionCandidate } from "./criterion-resolve";
import { tagItemCriteria } from "./marking";
import { readDocxText } from "./office";
import { paperProblems, publishPaper } from "./papers";
import { NOT_A_LEARNER_STEP, readProgrammeDocumentForAuthoring, type DocumentKind } from "./programme-documents";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { addPrerequisite, addStep } from "./spine";
import { getObject } from "./storage";

/**
 * Building a qualification from what the platform already holds, and making it
 * live in one act. Roland, 2 October 2026.
 *
 * "Having to Capture workbooks and assessments as a separate process is a
 * schlepp... Why not automatically build. The LMS must be clever. It knows how
 * everything is supposed to be connected and work together."
 *
 * Once a folder has been read, every document is filed against its study unit
 * under a known kind, and each paper is paired with its answer guide. That is
 * everything needed to build each study unit, so the platform builds it:
 *
 *   - a course for each study unit, tagged with what the unit achieves;
 *   - every workbook and summative captured and its questions linked to the
 *     unit's criteria (lib/criterion-resolve.ts); a paper the reader was unsure
 *     of is captured anyway and its findings listed, and one it cannot capture
 *     at all (a multiple-choice question with no answer) waits for a person,
 *     linked from the checklist;
 *   - the unit's steps in the order Roland chose: theory guides first; each
 *     workbook once the one before is handed in; the summative once every
 *     workbook is marked; workplace modules open throughout.
 *
 * All of it stays in draft. Nothing reaches a learner until somebody presses
 * the one "Verified, make it live" on the qualification, and that refuses for
 * as long as any regulatory check fails, saying what is missing (his choice:
 * hold everything rather than go live in parts).
 *
 * Run again, it fills gaps only: a paper captured, or steps somebody arranged
 * by hand, are left as they are.
 */

export type Finding = {
  studyUnit: string | null;
  what: string;
  /** Where to put it right. */
  href: string | null;
};

export type BuildReport = {
  units: { code: string; courseId: string; captured: number; relinked: number; stepsAdded: number; stepsKept: boolean }[];
  /** Captured anyway, worth a look before verifying. */
  toCheck: Finding[];
  /** Could not be done without a person. */
  waiting: Finding[];
};

/** The kinds of document a learner works through as a step of their own. */
const LEARNER_MATERIAL = new Set<DocumentKind>(["theory_guide", "learner_handbook", "learning_roadmap", "induction"]);

// ---------------------------------------------------------------------------
// The study unit's criteria, as the resolver wants them
// ---------------------------------------------------------------------------

export async function criteriaOfStudyUnit(
  session: AuthenticatedSession,
  studyUnitId: string,
): Promise<CriterionCandidate[]> {
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: assessmentCriteria.id,
        code: assessmentCriteria.code,
        moduleCode: curriculumModules.code,
        topicId: assessmentCriteria.topicId,
        topicCode: curriculumTopics.code,
      })
      .from(studyUnitModules)
      .innerJoin(curriculumModules, eq(curriculumModules.id, studyUnitModules.curriculumModuleId))
      .innerJoin(assessmentCriteria, eq(assessmentCriteria.curriculumModuleId, curriculumModules.id))
      .leftJoin(curriculumTopics, eq(curriculumTopics.id, assessmentCriteria.topicId))
      .where(eq(studyUnitModules.studyUnitId, studyUnitId))
      .orderBy(asc(curriculumModules.sortOrder), asc(curriculumTopics.sortOrder), asc(assessmentCriteria.sortOrder));

    const seen = new Map<string, number>();
    return rows.map((row) => {
      const position = row.topicId ? (seen.get(row.topicId) ?? 0) + 1 : null;
      if (row.topicId) seen.set(row.topicId, position!);
      return { id: row.id, code: row.code, moduleCode: row.moduleCode, topicCode: row.topicCode, positionInTopic: position };
    });
  });
}

// ---------------------------------------------------------------------------
// Capturing without a separate review
// ---------------------------------------------------------------------------

/**
 * What would stop a paper being saved at all. A multiple-choice or true-false
 * question needs at least two options and a correct answer among them, or
 * nothing could mark it; these the platform cannot decide for anybody.
 */
export function blockersIn(paper: ParsedPaper): string[] {
  if (paper.sections.length === 0) return ["No sections or questions could be read from it."];
  const blockers: string[] = [];
  for (const section of paper.sections) {
    for (const item of section.items) {
      if (item.type !== "multiple_choice" && item.type !== "true_false") continue;
      if (item.options.length < 2) {
        blockers.push(`"${item.stem.slice(0, 60)}" in "${section.title}" has fewer than two options.`);
      } else if (item.correctIndex === null || item.correctIndex >= item.options.length) {
        blockers.push(`"${item.stem.slice(0, 60)}" in "${section.title}" has no correct answer in the guide.`);
      }
    }
  }
  return blockers;
}

/** The assessment a paper belongs to: versions of one paper are papers of one assessment. */
async function assessmentFor(
  session: AuthenticatedSession,
  courseId: string,
  title: string,
  kind: string,
): Promise<string> {
  const base = title.replace(/\s*\b(?:V|Version\s*)\d+\b/gi, "").replace(/\s{2,}/g, " ").trim() || title;
  const [existing] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.courseId, courseId), eq(assessments.title, base)))
      .limit(1),
  );
  if (existing) return existing.id;
  const created = await createAssessment(session, {
    courseId,
    title: base,
    purpose: kind === "summative_assessment" ? "summative" : "formative",
  });
  return created.id;
}

// ---------------------------------------------------------------------------
// Re-linking papers captured before the criteria were resolved in context
// ---------------------------------------------------------------------------

async function relinkCourse(
  session: AuthenticatedSession,
  courseId: string,
  candidates: CriterionCandidate[],
): Promise<number> {
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const jobs = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: captureJobs.id, paperId: captureJobs.paperId, proposal: captureJobs.proposal, storageKey: captureJobs.paperStorageKey })
      .from(captureJobs)
      .innerJoin(assessmentPapers, eq(assessmentPapers.id, captureJobs.paperId))
      .innerJoin(assessments, eq(assessments.id, assessmentPapers.assessmentId))
      .where(and(eq(assessments.courseId, courseId), isNotNull(captureJobs.committedAt))),
  );

  let changed = 0;
  for (const job of jobs) {
    const proposal = job.proposal as ParsedPaper;
    const { sections, items, tags } = await withTenant(session.organisationId, async (tx) => {
      const sections = await tx
        .select({ id: assessmentSections.id })
        .from(assessmentSections)
        .where(eq(assessmentSections.paperId, job.paperId!))
        .orderBy(asc(assessmentSections.sortOrder));
      const items = sections.length
        ? await tx
            .select({ id: assessmentItems.id, sectionId: assessmentItems.sectionId })
            .from(assessmentItems)
            .where(inArray(assessmentItems.sectionId, sections.map((s) => s.id)))
            .orderBy(asc(assessmentItems.sortOrder))
        : [];
      const tags = items.length
        ? await tx
            .select({ itemId: assessmentItemCriteria.itemId, criterionId: assessmentItemCriteria.criterionId })
            .from(assessmentItemCriteria)
            .where(inArray(assessmentItemCriteria.itemId, items.map((i) => i.id)))
        : [];
      return { sections, items, tags };
    });

    // Only where the paper still has the shape it was captured with; one
    // edited since is somebody's own work and is not second-guessed.
    if (sections.length !== proposal.sections.length) continue;
    const bySection = sections.map((section) => items.filter((item) => item.sectionId === section.id));
    if (bySection.some((list, index) => list.length !== proposal.sections[index].items.length)) continue;

    let text = "";
    try {
      text = readDocxText(await getObject(job.storageKey));
    } catch {
      // The section headings carry the topics; the heading of the paper helps
      // but is not essential.
    }
    const { perItem } = resolvePaperCriteria(proposal, candidates, text);

    for (const [sectionIndex, list] of bySection.entries()) {
      for (const [itemIndex, item] of list.entries()) {
        const current = tags.filter((tag) => tag.itemId === item.id).map((tag) => tag.criterionId);
        const resolved = perItem[sectionIndex][itemIndex];
        const wrong = current.length === 0 || current.some((id) => !allowed.has(id));
        if (wrong && resolved.length > 0) {
          await tagItemCriteria(session, item.id, resolved);
          changed += 1;
        }
      }
    }
  }
  return changed;
}

/** An assessment's papers that are still drafts. */
async function draftPaperIds(session: AuthenticatedSession, assessmentId: string): Promise<string[]> {
  const rows = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: assessmentPapers.id })
      .from(assessmentPapers)
      .where(and(eq(assessmentPapers.assessmentId, assessmentId), ne(assessmentPapers.status, "published"))),
  );
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

/** "WB1" before "WB2" before "WB10", by the numbers in the title. */
function natural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function buildSteps(
  session: AuthenticatedSession,
  courseId: string,
  studyUnitId: string,
): Promise<{ added: number; kept: boolean }> {
  const { existing, guides, papers, workplace } = await withTenant(session.organisationId, async (tx) => {
    const existing = await tx.select({ id: courseSteps.id }).from(courseSteps).where(eq(courseSteps.courseId, courseId)).limit(1);
    const guides = await tx
      .select({ id: programmeDocuments.id, kind: programmeDocuments.kind, filename: programmeDocuments.filename })
      .from(programmeDocuments)
      .where(eq(programmeDocuments.studyUnitId, studyUnitId));
    const papers = await tx
      .select({ id: assessments.id, title: assessments.title, purpose: assessments.purpose })
      .from(assessments)
      .where(eq(assessments.courseId, courseId));
    const workplace = await tx
      .select({ id: curriculumModules.id, code: curriculumModules.code })
      .from(studyUnitModules)
      .innerJoin(curriculumModules, eq(curriculumModules.id, studyUnitModules.curriculumModuleId))
      .where(and(eq(studyUnitModules.studyUnitId, studyUnitId), eq(curriculumModules.component, "workplace")))
      .orderBy(asc(curriculumModules.sortOrder));
    return { existing, guides, papers, workplace };
  });

  // Steps somebody arranged are theirs.
  if (existing.length > 0) return { added: 0, kept: true };

  let added = 0;
  const material = guides
    .filter((doc) => LEARNER_MATERIAL.has(doc.kind as DocumentKind) && !NOT_A_LEARNER_STEP.has(doc.kind as DocumentKind))
    .sort((a, b) => natural(a.filename, b.filename));
  for (const doc of material) {
    await addStep(session, { courseId, kind: "document", programmeDocumentId: doc.id, release: "open" });
    added += 1;
  }

  const workbooks = papers.filter((p) => p.purpose !== "summative").sort((a, b) => natural(a.title, b.title));
  const summatives = papers.filter((p) => p.purpose === "summative").sort((a, b) => natural(a.title, b.title));

  const workbookSteps: string[] = [];
  for (const [index, workbook] of workbooks.entries()) {
    const step = await addStep(session, {
      courseId,
      kind: "assessment",
      assessmentId: workbook.id,
      release: material.length === 0 && index === 0 ? "open" : "sequential",
      // The first once the guide is opened; each after that once the one before is handed in.
      sequentialRule: index === 0 ? "opened" : "submitted",
    });
    workbookSteps.push(step.id);
    added += 1;
  }

  for (const summative of summatives) {
    const step = await addStep(session, {
      courseId,
      kind: "assessment",
      assessmentId: summative.id,
      release: workbookSteps.length > 0 ? "prerequisites" : "sequential",
      sequentialRule: "opened",
    });
    // Once every workbook has been marked.
    for (const required of workbookSteps) {
      await addPrerequisite(session, { stepId: step.id, requiredStepId: required, rule: "reviewed" });
    }
    added += 1;
  }

  for (const workplaceModule of workplace) {
    await addStep(session, { courseId, kind: "workplace", curriculumModuleId: workplaceModule.id, release: "open" });
    added += 1;
  }

  return { added, kept: false };
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

export async function buildQualification(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<BuildReport> {
  assertSessionCan(session, "course:author");
  assertSessionCan(session, "assessment:author");

  const units = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: studyUnits.id, code: studyUnits.code })
      .from(studyUnits)
      .where(eq(studyUnits.qualificationId, qualificationId))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code)),
  );
  const documents = await capturableDocuments(session, qualificationId);

  const report: BuildReport = { units: [], toCheck: [], waiting: [] };

  for (const unit of units) {
    const courseId = await courseForStudyUnit(session, unit.id);
    const candidates = await criteriaOfStudyUnit(session, unit.id);
    let captured = 0;

    for (const document of documents.filter((one) => one.studyUnitId === unit.id && !one.captured)) {
      const paper = await readProgrammeDocumentForAuthoring(session, document.documentId);
      const guide = document.guide ? await readProgrammeDocumentForAuthoring(session, document.guide.documentId) : null;
      const proposed = await proposeCapture(session, {
        qualificationId,
        paper: { filename: paper.filename, bytes: paper.bytes },
        guide: guide ? { filename: guide.filename, bytes: guide.bytes } : undefined,
      });
      const href = `/capture/${proposed.jobId}`;

      const blockers = blockersIn(proposed.proposal);
      if (blockers.length > 0) {
        report.waiting.push({
          studyUnit: unit.code,
          what: `${document.filename} was read but cannot be captured without a decision: ${blockers.slice(0, 2).join(" ")}${blockers.length > 2 ? ` There are ${blockers.length - 2} more.` : ""}`,
          href,
        });
        continue;
      }

      let text = "";
      try {
        text = readDocxText(paper.bytes);
      } catch {
        // Section headings are enough to resolve most codes.
      }
      const { perItem, unresolved } = resolvePaperCriteria(proposed.proposal, candidates, text);
      const assessmentId = await assessmentFor(session, courseId, document.title, document.kind);
      const version = versionOf(document.filename);
      const committed = await commitCapture(session, {
        jobId: proposed.jobId,
        assessmentId,
        paperCode: version ? `V${version}` : "V1",
        confirmed: proposed.proposal,
        criterionIds: {},
        itemCriterionIds: perItem,
        acknowledgedProblems: true,
      });
      captured += 1;

      const paperHref = `/papers/${committed.paperId}/preview`;
      for (const problem of proposed.problems) report.toCheck.push({ studyUnit: unit.code, what: `${document.filename}: ${problem}`, href: paperHref });
      for (const reason of unresolved) report.toCheck.push({ studyUnit: unit.code, what: `${document.filename}: ${reason}`, href: paperHref });
      if (!committed.published.ok) {
        report.waiting.push({
          studyUnit: unit.code,
          what: `${document.filename} was captured, but learners cannot answer it yet: ${committed.published.reasons.slice(0, 2).join(" ")}`,
          href: paperHref,
        });
      }
    }

    const relinked = await relinkCourse(session, courseId, candidates);
    const steps = await buildSteps(session, courseId, unit.id);
    report.units.push({ code: unit.code, courseId, captured, relinked, stepsAdded: steps.added, stepsKept: steps.kept });
  }

  await withTenant(session.organisationId, (tx) =>
    recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "qualification.built",
      entityType: "qualification",
      entityId: qualificationId,
      after: {
        units: report.units,
        toCheck: report.toCheck.length,
        waiting: report.waiting.length,
      },
    }),
  );

  return report;
}

/** What the qualification navigator lists: the qualification and each study unit's course. */
export async function qualificationNavigation(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<{ units: { code: string; title: string; courseId: string | null }[] }> {
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({ code: studyUnits.code, title: studyUnits.title, courseId: courses.id })
      .from(studyUnits)
      .leftJoin(courses, eq(courses.studyUnitId, studyUnits.id))
      .where(eq(studyUnits.qualificationId, qualificationId))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));
    // One course per study unit; a second version would list the unit twice.
    const units = new Map<string, { code: string; title: string; courseId: string | null }>();
    for (const row of rows) if (!units.has(row.code)) units.set(row.code, row);
    return { units: [...units.values()] };
  });
}

/** The qualification a study unit's course belongs to, for the navigator on its page. */
export async function qualificationOfCourse(session: AuthenticatedSession, courseId: string): Promise<string | null> {
  const [row] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ qualificationId: studyUnits.qualificationId })
      .from(courses)
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(eq(courses.id, courseId)),
  );
  return row?.qualificationId ?? null;
}

/** One sentence saying what a build did, for the notice after it. */
export function buildSummary(report: BuildReport): string {
  const units = report.units.length;
  const captured = report.units.reduce((sum, unit) => sum + unit.captured, 0);
  const steps = report.units.reduce((sum, unit) => sum + unit.stepsAdded, 0);
  const parts = [
    `Built ${units} ${units === 1 ? "study unit" : "study units"}`,
    `${captured} ${captured === 1 ? "paper" : "papers"} captured`,
    `${steps} ${steps === 1 ? "step" : "steps"} laid out`,
  ];
  const waiting = report.waiting.length > 0 ? ` ${report.waiting.length} ${report.waiting.length === 1 ? "thing needs" : "things need"} a person.` : "";
  return `${parts.join(", ")}, all in draft. Check it and make it live from the qualification's verification page.${waiting}`;
}

// ---------------------------------------------------------------------------
// Verifying, and making it live
// ---------------------------------------------------------------------------

export type UnitVerification = {
  id: string;
  code: string;
  title: string;
  courseId: string | null;
  live: boolean;
  steps: number;
  assessments: { id: string; title: string; purpose: string; status: string; papers: number; answerable: number; unlinked: number }[];
  /** Holds the whole qualification back. */
  blocking: Finding[];
  /** Worth a look; does not hold it back. */
  toCheck: Finding[];
};

export type Verification = {
  units: UnitVerification[];
  /** Every study unit live. */
  live: boolean;
  /** Nothing holding it back. */
  ready: boolean;
  /** Built at all: at least one study unit has its course. */
  built: boolean;
};

export async function verificationOf(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<Verification> {
  assertSessionCan(session, "course:read");

  const units = await withTenant(session.organisationId, async (tx) => {
    const list = await tx
      .select({ id: studyUnits.id, code: studyUnits.code, title: studyUnits.title })
      .from(studyUnits)
      .where(eq(studyUnits.qualificationId, qualificationId))
      .orderBy(asc(studyUnits.sortOrder), asc(studyUnits.code));
    return Promise.all(
      list.map(async (unit) => {
        const [course] = await tx
          .select({ id: courses.id, status: courses.status })
          .from(courses)
          .where(eq(courses.studyUnitId, unit.id))
          .limit(1);
        const steps = course ? await tx.select({ id: courseSteps.id }).from(courseSteps).where(eq(courseSteps.courseId, course.id)) : [];
        const papers = course
          ? await tx
              .select({
                assessmentId: assessments.id,
                title: assessments.title,
                purpose: assessments.purpose,
                status: assessments.status,
                paperId: assessmentPapers.id,
                paperStatus: assessmentPapers.status,
              })
              .from(assessments)
              .leftJoin(assessmentPapers, eq(assessmentPapers.assessmentId, assessments.id))
              .where(eq(assessments.courseId, course.id))
          : [];
        const paperIds = papers.map((p) => p.paperId).filter(Boolean) as string[];
        const unlinked = paperIds.length
          ? await tx
              .select({ paperId: assessmentSections.paperId, itemId: assessmentItems.id })
              .from(assessmentItems)
              .innerJoin(assessmentSections, eq(assessmentSections.id, assessmentItems.sectionId))
              .leftJoin(assessmentItemCriteria, eq(assessmentItemCriteria.itemId, assessmentItems.id))
              .where(and(inArray(assessmentSections.paperId, paperIds), isNull(assessmentItemCriteria.id)))
          : [];
        const waitingJobs = await tx
          .select({ id: captureJobs.id, filename: captureJobs.paperFilename })
          .from(captureJobs)
          .innerJoin(programmeDocuments, eq(programmeDocuments.sha256, captureJobs.paperSha256))
          .where(
            and(
              eq(captureJobs.qualificationId, qualificationId),
              isNull(captureJobs.committedAt),
              eq(programmeDocuments.studyUnitId, unit.id),
            ),
          );
        const assessable = await tx
          .select({ id: curriculumModules.id })
          .from(studyUnitModules)
          .innerJoin(curriculumModules, eq(curriculumModules.id, studyUnitModules.curriculumModuleId))
          .where(and(eq(studyUnitModules.studyUnitId, unit.id), ne(curriculumModules.component, "workplace")))
          .limit(1);
        return { unit, course, steps: steps.length, papers, unlinked, waitingJobs, assessable: assessable.length > 0 };
      }),
    );
  });

  const result: UnitVerification[] = [];
  for (const { unit, course, steps, papers, unlinked, waitingJobs, assessable } of units) {
    const blocking: Finding[] = [];
    const toCheck: Finding[] = [];
    const byAssessment = new Map<string, UnitVerification["assessments"][number]>();
    for (const row of papers) {
      const entry =
        byAssessment.get(row.assessmentId) ??
        { id: row.assessmentId, title: row.title, purpose: row.purpose, status: row.status, papers: 0, answerable: 0, unlinked: 0 };
      if (row.paperId) {
        entry.papers += 1;
        if (row.paperStatus === "published") entry.answerable += 1;
        entry.unlinked += unlinked.filter((u) => u.paperId === row.paperId).length;
      }
      byAssessment.set(row.assessmentId, entry);
    }

    if (!course) {
      blocking.push({ studyUnit: unit.code, what: `${unit.code} has not been built yet.`, href: null });
    } else {
      // The alignment matrix can say every criterion is assessed by papers
      // the platform has never been given, and the coverage check takes its
      // word. A unit with nothing for a learner to answer could then be
      // finished without anybody being assessed. A unit of workplace modules
      // only is signed off at work, not answered on paper.
      if (assessable && byAssessment.size === 0 && course.status !== "published") {
        blocking.push({
          studyUnit: unit.code,
          what: `${unit.code} has no workbooks or assessments, so a learner could finish it without being assessed. File its papers in the qualification's documents and build again.`,
          href: `/qualifications/${qualificationId}?view=build#material`,
        });
      }
      if (course.status !== "published") {
        const checks = await coursePublishChecks(session, course.id);
        if (!checks.ok) for (const reason of checks.reasons) blocking.push({ studyUnit: unit.code, what: reason, href: `/courses/${course.id}` });
      }
      for (const assessment of byAssessment.values()) {
        if (assessment.answerable === 0) {
          // Why, not only that. Roland, 2 October: "the system doesn't help to
          // indicate what is wrong." A paper that fails its own checks says
          // which question and what is missing.
          const draftPapers = papers.filter((row) => row.assessmentId === assessment.id && row.paperId).map((row) => row.paperId!);
          const reasons = [...new Set((await Promise.all(draftPapers.map((paperId) => paperProblems(session, paperId)))).flat())];
          const shown = reasons.slice(0, 3).join(" ");
          const more = reasons.length > 3 ? ` There are ${reasons.length - 3} more like these.` : "";
          // A paper that passes its checks is opened when the qualification
          // is made live, so it holds nothing back.
          if (draftPapers.length === 0 || reasons.length > 0) {
            blocking.push({
              studyUnit: unit.code,
              what:
                draftPapers.length === 0
                  ? `"${assessment.title}" has no paper captured yet.`
                  : `"${assessment.title}" cannot be answered yet: ${shown}${more}`,
              href: `/courses/${course.id}/assessments`,
            });
          }
        }
        if (assessment.unlinked > 0) {
          toCheck.push({
            studyUnit: unit.code,
            what: `${assessment.unlinked} ${assessment.unlinked === 1 ? "question" : "questions"} on "${assessment.title}" ${assessment.unlinked === 1 ? "is" : "are"} linked to no assessment criterion.`,
            href: `/courses/${course.id}/assessments`,
          });
        }
      }
    }
    for (const job of waitingJobs) {
      blocking.push({ studyUnit: unit.code, what: `${job.filename} is waiting for a person to review it in Capture.`, href: `/capture/${job.id}` });
    }

    result.push({
      id: unit.id,
      code: unit.code,
      title: unit.title,
      courseId: course?.id ?? null,
      live: course?.status === "published",
      steps,
      assessments: [...byAssessment.values()],
      blocking,
      toCheck,
    });
  }

  return {
    units: result,
    live: result.length > 0 && result.every((unit) => unit.live),
    ready: result.length > 0 && result.every((unit) => unit.blocking.length === 0),
    built: result.some((unit) => unit.courseId !== null),
  };
}

/**
 * The one act that makes a built qualification live: every study unit's
 * assessments and course published together, or nothing at all while any
 * check fails (Roland's choice, 2 October: hold everything, show why).
 */
export async function verifyAndPublish(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<{ ok: true; published: number } | { ok: false; blocking: Finding[] }> {
  assertSessionCan(session, "course:publish");
  assertSessionCan(session, "assessment:author");

  const verification = await verificationOf(session, qualificationId);
  const blocking = verification.units.flatMap((unit) => unit.blocking);
  if (blocking.length > 0) return { ok: false, blocking };

  let published = 0;
  for (const unit of verification.units) {
    if (!unit.courseId || unit.live) continue;
    for (const assessment of unit.assessments) {
      // Papers that passed their checks but were never opened: opened now.
      for (const paperId of await draftPaperIds(session, assessment.id)) {
        const opened = await publishPaper(session, paperId);
        if (!opened.ok) return { ok: false, blocking: opened.reasons.map((what) => ({ studyUnit: unit.code, what, href: `/courses/${unit.courseId}/assessments` })) };
      }
      if (assessment.status !== "published") await publishAssessment(session, assessment.id);
    }
    const result = await publishCourse(session, unit.courseId);
    // Checked a moment ago; a refusal now means something changed underneath.
    if (!result.ok) return { ok: false, blocking: result.reasons.map((what) => ({ studyUnit: unit.code, what, href: `/courses/${unit.courseId}` })) };
    published += 1;
  }

  await withTenant(session.organisationId, (tx) =>
    recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "qualification.verified",
      entityType: "qualification",
      entityId: qualificationId,
      after: { studyUnitsPublished: published },
    }),
  );

  return { ok: true, published };
}
