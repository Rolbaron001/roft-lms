import { and, eq, isNotNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  captureJobs,
  programmeDocuments,
  studyUnits,
} from "@/db/schema";
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
): Promise<{ jobId: string }> {
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

  return { jobId };
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
