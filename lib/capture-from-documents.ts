import { and, eq, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessments,
  captureJobs,
  courses,
  programmeDocuments,
  studyUnits,
} from "@/db/schema";
import { createCourse } from "./authoring";
import { ensureStudyUnitCompetency } from "./unit-competency";
import { createAssessment } from "./assessment";
import { namingConventionFor, proposeCapture } from "./capture";
import { classifyFilename } from "./naming-convention";
import { readProgrammeDocumentForAuthoring } from "./programme-documents";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Capturing a workbook the platform already holds.
 *
 * Roland, 21 September: "I don't see why this is a separate process. The
 * workbooks and assessments are in the folder, they have been read and linked.
 * Why can't they just be captured?"
 *
 * He is right. A folder import stores eighty files, classifies each one and
 * files it against its study unit - and then Capture asked the same person to
 * find those files on their own computer and upload them a second time. The
 * bytes were already in the platform, under a known kind, beside the study
 * unit they belong to. Uploading them again was work the platform was making
 * somebody do to compensate for two screens not knowing about each other.
 *
 * What cannot be skipped is the *review*. A parser that reads question three's
 * correct answer wrongly produces confidently wrong marking, and nobody finds
 * out until a moderator does or a learner appeals. So this removes the second
 * upload and nothing else: it builds the same proposal, from the same parser,
 * and lands on the same screen for the same person to confirm.
 *
 * Pairing the answer guide is the other half. Curiosa file
 * `CA 121151 SU1 WB1.docx` beside `CA 121151 SU1 WB1 AG.docx`, and the
 * tenant's own naming convention already knows that `AG` marks a memorandum -
 * the same convention Capture uses to read an uploaded filename. So the pair
 * is found rather than asked for.
 */

/** A paper that could be captured, with its memorandum where one is filed. */
export type Capturable = {
  documentId: string;
  filename: string;
  title: string;
  kind: string;
  studyUnitId: string | null;
  studyUnitCode: string | null;
  /** The answer guide filed beside it, matched by the naming convention. */
  guide: { documentId: string; filename: string } | null;
  /**
   * Whether these exact bytes have been through Capture already.
   *
   * Matched on the digest rather than the name: the same paper under two names
   * is the same paper, and a corrected V2 under the same name is not.
   */
  captured: boolean;
};

/** The kinds worth capturing: a paper a learner answers. */
const PAPERS = new Set(["workbook", "summative_assessment"]);

/** The memorandum that belongs with each of them. */
const MEMORANDUM_FOR: Record<string, string> = {
  workbook: "workbook_memorandum",
  summative_assessment: "summative_memorandum",
};

/**
 * What a document is, under this tenant's naming convention, reduced to the
 * part that identifies one artefact: its study unit, its kind and its number.
 *
 * `SU1 WB1` and `SU1 WB1 AG` share this; `SU1 WB2 AG` does not. Falling back
 * to the filename without the memorandum marker means a provider whose
 * convention the classifier cannot read still gets a pairing, rather than
 * every guide being reported as missing.
 */
function artefactKey(
  filename: string,
  convention: Parameters<typeof classifyFilename>[1],
): string {
  const read = classifyFilename(filename, convention);

  if (read.studyUnit && read.artefact && read.number) {
    return `${read.studyUnit}/${read.artefact}${read.number}`.toUpperCase();
  }

  const marker = convention?.memorandumMarker ?? "AG";
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(new RegExp(`\\b${marker}\\b`, "gi"), "")
    .replace(/[^a-z0-9]+/gi, "")
    .toUpperCase();
}

/**
 * Every paper filed against this qualification, and whether it is captured.
 *
 * Read from the documents rather than from a list somebody maintains, so a
 * file added to the folder later appears here without anybody being told to
 * look again.
 */
export async function capturableDocuments(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<Capturable[]> {
  assertSessionCan(session, "assessment:author");

  const convention = await namingConventionFor(session);

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: programmeDocuments.id,
        filename: programmeDocuments.filename,
        title: programmeDocuments.title,
        kind: programmeDocuments.kind,
        sha256: programmeDocuments.sha256,
        studyUnitId: programmeDocuments.studyUnitId,
        studyUnitCode: studyUnits.code,
      })
      .from(programmeDocuments)
      .leftJoin(studyUnits, eq(studyUnits.id, programmeDocuments.studyUnitId))
      .where(eq(programmeDocuments.qualificationId, qualificationId));

    const papers = rows.filter((row) => PAPERS.has(row.kind));
    if (papers.length === 0) return [];

    // Everything already captured, by digest. One query rather than one per
    // paper: a folder import files eighty documents and this screen is opened
    // every time somebody looks at the qualification.
    const done = await tx
      .select({ sha256: captureJobs.paperSha256 })
      .from(captureJobs)
      .where(
        and(
          eq(captureJobs.qualificationId, qualificationId),
          isNotNull(captureJobs.paperSha256),
        ),
      );
    const captured = new Set(done.map((row) => row.sha256));

    const memoranda = rows.filter((row) =>
      Object.values(MEMORANDUM_FOR).includes(row.kind),
    );

    return papers
      .map((paper) => {
        const wanted = MEMORANDUM_FOR[paper.kind];
        const key = artefactKey(paper.filename, convention);

        const guide = memoranda.find(
          (one) =>
            one.kind === wanted &&
            one.studyUnitId === paper.studyUnitId &&
            artefactKey(one.filename, convention) === key,
        );

        return {
          documentId: paper.id,
          filename: paper.filename,
          title: paper.title,
          kind: paper.kind,
          studyUnitId: paper.studyUnitId,
          studyUnitCode: paper.studyUnitCode,
          guide: guide
            ? { documentId: guide.id, filename: guide.filename }
            : null,
          captured: captured.has(paper.sha256),
        };
      })
      .sort(
        (a, b) =>
          (a.studyUnitCode ?? "").localeCompare(b.studyUnitCode ?? "") ||
          a.filename.localeCompare(b.filename),
      );
  });
}

/**
 * Builds a capture proposal from documents the platform already holds.
 *
 * Nothing is uploaded and nothing is stored twice: the bytes come back out of
 * the store they went into. What comes out the other end is an ordinary
 * capture job, indistinguishable from an uploaded one, waiting on the same
 * review.
 */
export async function captureFiledDocument(
  session: AuthenticatedSession,
  input: { qualificationId: string; documentId: string },
): Promise<{ jobId: string; assessmentId: string | null }> {
  assertSessionCan(session, "assessment:author");

  const candidates = await capturableDocuments(
    session,
    input.qualificationId,
  );
  const chosen = candidates.find(
    (one) => one.documentId === input.documentId,
  );

  if (!chosen) {
    throw new Error(
      "That document is not one of this qualification's papers, so there is nothing to capture from it.",
    );
  }

  /*
   * Read as an authoring act rather than as a download.
   *
   * The plain reader refuses a summative or a memorandum to anybody without
   * `assessment:assess`, which is right for a download and wrong here: it
   * would mean only an assessor could author an assessment, and the assessor
   * role exists on the stated basis that it "cannot author the assessment they
   * mark". See readProgrammeDocumentForAuthoring.
   */
  const paper = await readProgrammeDocumentForAuthoring(
    session,
    chosen.documentId,
  );
  const guide = chosen.guide
    ? await readProgrammeDocumentForAuthoring(session, chosen.guide.documentId)
    : null;

  const { jobId } = await proposeCapture(session, {
    qualificationId: input.qualificationId,
    paper: { filename: paper.filename, bytes: paper.bytes },
    guide: guide
      ? { filename: guide.filename, bytes: guide.bytes }
      : undefined,
  });

  /*
   * Somewhere for it to land, made now rather than left to the review screen.
   *
   * A capture commits into a draft assessment, and a folder import creates no
   * courses at all, so the review screen offered an empty list and the work
   * stopped: the paper was read, checked, and had nowhere to go. Creating the
   * course and the assessment here means the person arrives at a screen that
   * can be finished.
   *
   * Only where the document names a study unit. A paper filed against the
   * qualification as a whole has no unit to deliver it, and guessing one would
   * put a workbook under a unit it does not belong to.
   */
  let assessmentId: string | null = null;

  if (chosen.studyUnitId) {
    const courseId = await courseForStudyUnit(session, chosen.studyUnitId);
    assessmentId = await assessmentForPaper(session, {
      courseId,
      title: chosen.title,
      kind: chosen.kind,
    });
  }

  return { jobId, assessmentId };
}

/** How far this qualification's papers have got, for a progress map. */
export async function captureProgress(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<{ total: number; captured: number; withoutGuide: number }> {
  const papers = await capturableDocuments(session, qualificationId);

  return {
    total: papers.length,
    captured: papers.filter((one) => one.captured).length,
    withoutGuide: papers.filter((one) => !one.guide).length,
  };
}

/**
 * Somewhere for a captured paper to land.
 *
 * A capture becomes an assessment, an assessment belongs to a course, and a
 * course is what a learner is put onto. A folder import creates study units
 * and no courses, so until now the review screen offered an empty list and the
 * work stopped there: the paper was read, checked, and had nowhere to go.
 *
 * The course is the study unit's own delivery record. It carries the unit's
 * guide, its workbooks and its summative, which is what `courses.studyUnitId`
 * exists for. A provider who calls that thing a study unit rather than a
 * course sees their own word for it, because the word is a tenant setting and
 * this is the record beneath it. See lib/features.ts.
 *
 * Found rather than made wherever possible. Running this twice on the same
 * study unit must not leave two courses with the same name and the material
 * split between them.
 */
export async function courseForStudyUnit(
  session: AuthenticatedSession,
  studyUnitId: string,
): Promise<string> {
  assertSessionCan(session, "course:author");

  const existing = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.studyUnitId, studyUnitId))
      .limit(1),
  );

  if (existing[0]) return existing[0].id;

  const [unit] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ code: studyUnits.code, title: studyUnits.title })
      .from(studyUnits)
      .where(eq(studyUnits.id, studyUnitId)),
  );

  if (!unit) {
    throw new Error("That study unit does not exist, so nothing can deliver it.");
  }

  /*
   * Named after the study unit rather than after the qualification or the
   * paper. Somebody looking at a list of these is looking for SU3, and a
   * course called "Workbook 2" tells them nothing about where it belongs.
   */
  const created = await createCourse(session, {
    title: `${unit.code} ${unit.title}`.trim(),
    studyUnitId,
  });

  // Tagged with what the unit achieves from the start, so nobody has to find
  // a competency in a list that has nothing to do with the qualification (W5).
  await withTenant(session.organisationId, (tx) =>
    ensureStudyUnitCompetency(tx, session.organisationId, created.id),
  );

  return created.id;
}

/**
 * The draft assessment a captured paper commits into, made if it is missing.
 *
 * Draft, always. `commitCapture` writes the questions into it and publishing is
 * a separate, deliberate act with its own checks: an assessment that published
 * itself the moment a workbook was read would put an unreviewed paper in front
 * of a learner.
 *
 * A summative is marked as one. It is not a label: a summative is moderated in
 * full rather than sampled, and getting that wrong silences the moderation the
 * qualification depends on.
 */
export async function assessmentForPaper(
  session: AuthenticatedSession,
  input: { courseId: string; title: string; kind: string },
): Promise<string> {
  assertSessionCan(session, "assessment:author");

  const existing = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(
        and(
          eq(assessments.courseId, input.courseId),
          eq(assessments.title, input.title),
        ),
      )
      .limit(1),
  );

  if (existing[0]) return existing[0].id;

  const created = await createAssessment(session, {
    courseId: input.courseId,
    title: input.title,
    purpose: input.kind === "summative_assessment" ? "summative" : "formative",
  });

  return created.id;
}
