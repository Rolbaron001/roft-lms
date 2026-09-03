import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  curriculumModules,
  programmeDocuments,
  qualifications,
  studyUnits,
  users,
} from "@/db/schema";
import { detectMedia, describeSize, SIZE_LIMITS } from "./media";
import { buildStorageKey, getObject, putObject } from "./storage";
import {
  readDocxText,
  readPdfText,
  readXlsxSheets,
  OfficeReadError,
} from "./office";
import { importAlignmentMatrix, type MatrixImportSummary } from "./alignment-matrix";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The programme document library.
 *
 * A provider's learning material is written in Word and Excel and always
 * will be: handbooks, workbooks, marking memoranda and workplace sign-off
 * sheets are print artefacts that a facilitator annotates and a moderator
 * marks up by hand. Trying to author them in a web form would produce worse
 * documents and a tool nobody uses.
 *
 * What the platform is for is holding the authoritative copy — attached to the
 * part of the curriculum it serves, at a known version, hashed so it can be
 * proved unchanged — and reading the ones that carry structure so they fill
 * the platform rather than sitting in it. Today that means the alignment
 * matrix; the rest are held, searchable, and downloadable.
 */

export class ProgrammeDocumentError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "rejected" | "too_large" | "unreadable",
  ) {
    super(message);
    this.name = "ProgrammeDocumentError";
  }
}

export const DOCUMENT_KINDS = [
  "qualification_document",
  "curriculum_document",
  "assessment_specification",
  "alignment_matrix",
  "learner_handbook",
  "theory_guide",
  "workbook",
  "workbook_memorandum",
  "summative_assessment",
  "summative_memorandum",
  "workplace_signoff",
  "workplace_coach_guide",
  "workplace_agreement",
  "learning_programme_guide",
  "facilitation_plan",
  "rollout_schedule",
  "induction",
  "learning_roadmap",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  qualification_document: "SAQA qualification document",
  curriculum_document: "Curriculum document",
  assessment_specification: "Assessment specification",
  alignment_matrix: "Curriculum alignment matrix",
  learner_handbook: "Learner handbook",
  theory_guide: "Theory guide",
  workbook: "Workbook",
  workbook_memorandum: "Workbook marking memorandum",
  summative_assessment: "Summative assessment",
  summative_memorandum: "Summative marking memorandum",
  workplace_signoff: "Workplace sign-off sheet",
  workplace_coach_guide: "Workplace coach guide",
  workplace_agreement: "Workplace experience agreement",
  learning_programme_guide: "Learning programme guide",
  facilitation_plan: "Facilitation plan",
  rollout_schedule: "Roll-out schedule",
  induction: "Induction pack",
  learning_roadmap: "Learning roadmap",
  other: "Other document",
};

/**
 * Memoranda hold the answers. A learner who can download one has been handed
 * the assessment, so they are marked here and the download path refuses them
 * to anybody without the right to assess.
 */
const RESTRICTED_KINDS = new Set<DocumentKind>([
  "workbook_memorandum",
  "summative_memorandum",
  "summative_assessment",
]);

export const documentInput = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string().trim().min(2).max(300),
  version: z.string().trim().max(50).optional(),
  qualificationId: z.string().uuid().optional(),
  studyUnitId: z.string().uuid().optional(),
  curriculumModuleId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  learningPathId: z.string().uuid().optional(),
});

export type DocumentInput = z.input<typeof documentInput>;

/**
 * Pulls readable text out of a file so it can be searched later, and so a
 * curriculum can be transcribed from the document rather than from a printout
 * beside the keyboard.
 *
 * Word, Excel and PDF. A file that cannot be read is still worth keeping: the
 * upload succeeds and the text is null, which is the truth. What it must not
 * do is be quiet about it — a scanned PDF files perfectly and then helps with
 * nothing, and the person who uploaded it is the only one who can go and find
 * a digital copy.
 */
async function extractText(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ text: string | null; notice?: string }> {
  try {
    if (mimeType.includes("wordprocessingml")) {
      return { text: readDocxText(bytes).slice(0, 500_000) };
    }

    if (mimeType.includes("spreadsheetml")) {
      return {
        text: readXlsxSheets(bytes)
          .map(
            (sheet) =>
              `${sheet.name}\n${sheet.rows.map((row) => row.join("\t")).join("\n")}`,
          )
          .join("\n\n")
          .slice(0, 500_000),
      };
    }

    if (mimeType.includes("pdf")) {
      const pdf = await readPdfText(bytes);

      if (pdf.looksScanned) {
        return {
          text: pdf.text.length > 0 ? pdf.text.slice(0, 500_000) : null,
          notice:
            `This looks like a scan: ${pdf.pages} pages with almost no text in them. ` +
            "The file is stored and can be downloaded, but the platform cannot read it, " +
            "so it cannot help you build the curriculum from it. If there is a digital " +
            "copy of this document, upload that instead.",
        };
      }

      return { text: pdf.text.slice(0, 500_000) };
    }
  } catch (error) {
    if (!(error instanceof OfficeReadError)) throw error;
    // The reader's own words: they say which file and why, which a caller
    // cannot reconstruct from a null.
    return { text: null, notice: error.message };
  }

  return { text: null };
}

export async function uploadProgrammeDocument(
  session: AuthenticatedSession,
  input: DocumentInput,
  file: { filename: string; bytes: Uint8Array },
): Promise<{ id: string; matrix?: MatrixImportSummary; notice?: string }> {
  assertSessionCan(session, "qualification:manage");
  const parsed = documentInput.parse(input);

  const scopes = [
    parsed.qualificationId,
    parsed.studyUnitId,
    parsed.curriculumModuleId,
    parsed.courseId,
    parsed.learningPathId,
  ].filter(Boolean);

  if (scopes.length !== 1) {
    throw new ProgrammeDocumentError(
      "Attach the document to exactly one of a qualification, a study unit, a module, a course or a programme.",
      "rejected",
    );
  }

  const detected = detectMedia(file.bytes, file.filename);
  if (!detected.ok) {
    throw new ProgrammeDocumentError(detected.reason, "rejected");
  }

  const limit = SIZE_LIMITS[detected.kind];
  if (file.bytes.byteLength > limit) {
    throw new ProgrammeDocumentError(
      `That ${detected.label.toLowerCase()} is ${describeSize(file.bytes.byteLength)}. The limit for this kind of file is ${describeSize(limit)}.`,
      "too_large",
    );
  }

  // Read before storing. An alignment matrix that cannot be understood should
  // fail the upload rather than land in the library looking imported.
  const { text: extractedText, notice } = await extractText(
    file.bytes,
    detected.mimeType,
  );

  const key = buildStorageKey(
    session.organisationId,
    parsed.kind,
    file.filename,
    "programme",
  );
  const stored = await putObject(key, file.bytes, detected.mimeType);

  const id = await withTenant(session.organisationId, async (tx) => {
    // Resolving the owning qualification for a study unit or module, so the
    // library can be listed by qualification whatever the document hangs off.
    let qualificationId = parsed.qualificationId ?? null;

    if (!qualificationId && parsed.studyUnitId) {
      const [unit] = await tx
        .select({ qualificationId: studyUnits.qualificationId })
        .from(studyUnits)
        .where(eq(studyUnits.id, parsed.studyUnitId));
      if (!unit) {
        throw new ProgrammeDocumentError("Study unit not found.", "not_found");
      }
      qualificationId = unit.qualificationId;
    }

    if (!qualificationId && parsed.curriculumModuleId) {
      const [curriculumModule] = await tx
        .select({ qualificationId: curriculumModules.qualificationId })
        .from(curriculumModules)
        .where(eq(curriculumModules.id, parsed.curriculumModuleId));
      if (!curriculumModule) {
        throw new ProgrammeDocumentError("Module not found.", "not_found");
      }
      qualificationId = curriculumModule.qualificationId;
    }

    // Supersedes the previous document of the same kind and title, so the
    // library shows the current one and the chain back is still there.
    const [previous] = await tx
      .select({ id: programmeDocuments.id })
      .from(programmeDocuments)
      .where(
        and(
          eq(programmeDocuments.kind, parsed.kind),
          eq(programmeDocuments.title, parsed.title),
        ),
      )
      .orderBy(desc(programmeDocuments.createdAt))
      .limit(1);

    const [created] = await tx
      .insert(programmeDocuments)
      .values({
        organisationId: session.organisationId,
        qualificationId,
        studyUnitId: parsed.studyUnitId ?? null,
        curriculumModuleId: parsed.curriculumModuleId ?? null,
        courseId: parsed.courseId ?? null,
        learningPathId: parsed.learningPathId ?? null,
        kind: parsed.kind,
        title: parsed.title,
        version: parsed.version ?? null,
        filename: file.filename,
        storageKey: stored.storageKey,
        mimeType: detected.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        extractedText,
        uploadedById: session.userId,
        supersedesId: previous?.id ?? null,
      })
      .returning({ id: programmeDocuments.id });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "programme_document.uploaded",
      entityType: "programme_document",
      entityId: created.id,
      after: {
        kind: parsed.kind,
        title: parsed.title,
        version: parsed.version ?? null,
        filename: file.filename,
        sha256: stored.sha256,
        supersedes: previous?.id ?? null,
      },
    });

    return created.id;
  });

  // An alignment matrix is not just filed: it is read, and what it says about
  // the curriculum is recorded. This is the whole point of accepting it.
  let matrix: MatrixImportSummary | undefined;

  if (parsed.kind === "alignment_matrix") {
    const target = parsed.qualificationId;
    if (target) {
      matrix = await importAlignmentMatrix(session, target, file.bytes);
    }
  }

  return { id, matrix, notice };
}

export async function listProgrammeDocuments(
  session: AuthenticatedSession,
  qualificationId: string,
) {
  assertSessionCan(session, "course:read");

  const canSeeMemoranda = session.permissions.includes("assessment:assess");

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: programmeDocuments.id,
        kind: programmeDocuments.kind,
        title: programmeDocuments.title,
        version: programmeDocuments.version,
        filename: programmeDocuments.filename,
        mimeType: programmeDocuments.mimeType,
        sizeBytes: programmeDocuments.sizeBytes,
        sha256: programmeDocuments.sha256,
        createdAt: programmeDocuments.createdAt,
        studyUnitCode: studyUnits.code,
        moduleCode: curriculumModules.code,
        uploadedBy: users.firstName,
        uploadedBySurname: users.lastName,
      })
      .from(programmeDocuments)
      .leftJoin(studyUnits, eq(studyUnits.id, programmeDocuments.studyUnitId))
      .leftJoin(
        curriculumModules,
        eq(curriculumModules.id, programmeDocuments.curriculumModuleId),
      )
      .leftJoin(users, eq(users.id, programmeDocuments.uploadedById))
      .where(eq(programmeDocuments.qualificationId, qualificationId))
      .orderBy(desc(programmeDocuments.createdAt));

    return rows.filter(
      (row) =>
        canSeeMemoranda || !RESTRICTED_KINDS.has(row.kind as DocumentKind),
    );
  });
}

/**
 * A document's bytes, for download.
 *
 * The permission check is here rather than in the route, so no future caller
 * can reach a marking memorandum by a different path.
 */
export async function readProgrammeDocument(
  session: AuthenticatedSession,
  documentId: string,
) {
  assertSessionCan(session, "course:read");

  const document = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select()
      .from(programmeDocuments)
      .where(eq(programmeDocuments.id, documentId));
    return row;
  });

  if (!document) {
    throw new ProgrammeDocumentError("Document not found.", "not_found");
  }

  if (
    RESTRICTED_KINDS.has(document.kind as DocumentKind) &&
    !session.permissions.includes("assessment:assess")
  ) {
    throw new ProgrammeDocumentError(
      "Marking memoranda and summative assessments are limited to assessors.",
      "not_found",
    );
  }

  const bytes = await getObject(document.storageKey);

  return {
    bytes,
    filename: document.filename,
    mimeType: document.mimeType,
  };
}

export async function qualificationForDocumentUpload(
  session: AuthenticatedSession,
  qualificationId: string,
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select({ id: qualifications.id, title: qualifications.title })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    const units = await tx
      .select({ id: studyUnits.id, code: studyUnits.code, title: studyUnits.title })
      .from(studyUnits)
      .where(eq(studyUnits.qualificationId, qualificationId));

    const modules = await tx
      .select({
        id: curriculumModules.id,
        code: curriculumModules.code,
        title: curriculumModules.title,
      })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));

    return { qualification, units, modules };
  });
}
