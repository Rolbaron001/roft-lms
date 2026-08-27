import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { readPdfText, readDocxText, OfficeReadError } from "./office";
import {
  parseCurriculumText,
  type ParsedCurriculum,
  type ParsedQualification,
} from "./curriculum-parse";
import {
  parseQualificationDocument,
  type ParsedExitLevelOutcome,
} from "./qualification-document-parse";
import {
  importCurriculum,
  type CurriculumFileInput,
  type ImportSummary,
} from "./curriculum-import";
import { uploadProgrammeDocument } from "./programme-documents";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Creating a qualification from the three documents that define it.
 *
 * These three are the foundation everything else is built on, and each carries
 * something the others do not:
 *
 *   Qualification Document   the SAQA registration extract — the SAQA ID, and
 *                            the Exit Level Outcomes with their Associated
 *                            Assessment Criteria, which the EISA is set against
 *   Curriculum Document      the modules, topics, and the internal assessment
 *                            criteria a provider teaches and assesses against
 *   Assessment Specification the EISA specification, filed and indexed so it is
 *                            searchable and available to a moderator
 *
 * The alternative was a form asking somebody to retype a title, a code, an NQF
 * level and a credit total that are printed on page one of files the platform
 * can already read — then three separate uploads, then a fourth pass to import
 * the modules.
 *
 * So: read them, show what was found, let somebody correct the handful of
 * header fields, and write the qualification, its outcomes and its whole
 * curriculum in one go — with all three documents filed against it, which is
 * also what satisfies the readiness gate before any material is authored.
 */

export class QualificationImportError extends Error {
  constructor(
    message: string,
    readonly reason: "unreadable" | "not_a_curriculum" | "already_exists",
  ) {
    super(message);
    this.name = "QualificationImportError";
  }
}

export type SourceFile = { filename: string; bytes: Uint8Array };

export type SourceDocuments = {
  /** The only one that is required: nothing else states the modules. */
  curriculum: SourceFile;
  qualification?: SourceFile | null;
  assessmentSpecification?: SourceFile | null;
};

export type ModuleSummary = {
  code: string;
  component: string;
  title: string;
  credits: number | null;
  topics: number;
  elements: number;
  criteria: number;
};

export type DocumentReading = {
  /** The header fields, merged across whichever documents were supplied. */
  details: ParsedQualification & { saqaId: string | null };
  modules: ModuleSummary[];
  exitLevelOutcomes: ParsedExitLevelOutcome[];
  notes: string[];
  totals: {
    modules: number;
    topics: number;
    elements: number;
    criteria: number;
    exitLevelOutcomes: number;
    associatedCriteria: number;
  };
  /** Which of the three were supplied, for the confirmation screen to show. */
  supplied: {
    curriculum: boolean;
    qualification: boolean;
    assessmentSpecification: boolean;
  };
  existing: { id: string; title: string } | null;
};

async function textFrom(file: SourceFile): Promise<string> {
  if (/\.docx?$/i.test(file.filename)) return readDocxText(file.bytes);

  const result = await readPdfText(file.bytes);
  if (result.looksScanned) {
    throw new QualificationImportError(
      `"${file.filename}" looks like a scan: ${result.pages} pages with almost no text in them. The platform cannot read it, so nothing can be indexed from it. Upload a digital copy.`,
      "unreadable",
    );
  }
  return result.text;
}

async function readOrExplain(file: SourceFile): Promise<string> {
  try {
    return await textFrom(file);
  } catch (error) {
    if (error instanceof QualificationImportError) throw error;
    if (error instanceof OfficeReadError) {
      throw new QualificationImportError(
        `"${file.filename}": ${error.message}`,
        "unreadable",
      );
    }
    throw new QualificationImportError(
      `"${file.filename}" could not be read.`,
      "unreadable",
    );
  }
}

/** Reads whichever documents were supplied and reports what they say. Writes nothing. */
export async function readQualificationSources(
  session: AuthenticatedSession,
  documents: SourceDocuments,
): Promise<DocumentReading> {
  assertSessionCan(session, "qualification:manage");

  const curriculum = parseCurriculumText(
    await readOrExplain(documents.curriculum),
  );

  if (curriculum.modules.length === 0) {
    throw new QualificationImportError(
      `No curriculum modules were found in "${documents.curriculum.filename}". Check it is the Curriculum Document rather than the Qualification Document or the Assessment Specification.`,
      "not_a_curriculum",
    );
  }

  const registration = documents.qualification
    ? parseQualificationDocument(await readOrExplain(documents.qualification))
    : null;

  // The specification is read so that it is indexed and searchable, and so a
  // scan is caught here rather than after the qualification exists.
  if (documents.assessmentSpecification) {
    await readOrExplain(documents.assessmentSpecification);
  }

  // The SAQA registration is the authority on the qualification's own details;
  // the curriculum document restates them and is the fallback. The SAQA ID
  // appears in neither anywhere else, so it is registration-only.
  const details = {
    saqaId: registration?.saqaId ?? null,
    title: registration?.title ?? curriculum.qualification.title,
    qctoCode: curriculum.qualification.qctoCode,
    nqfLevel: registration?.nqfLevel ?? curriculum.qualification.nqfLevel,
    totalCredits:
      registration?.totalCredits ?? curriculum.qualification.totalCredits,
  };

  const notes = [...curriculum.notes, ...(registration?.notes ?? [])];

  if (!documents.qualification) {
    notes.push(
      "No Qualification Document was supplied, so there is no SAQA ID and no Exit Level Outcomes. Both can be added later, but the EISA is set against the outcomes.",
    );
  }
  if (!documents.assessmentSpecification) {
    notes.push(
      "No Assessment Specification was supplied. It is one of the three documents required before material can be authored against this qualification.",
    );
  }

  const existing = details.qctoCode
    ? await withTenant(session.organisationId, async (tx) => {
        const [row] = await tx
          .select({ id: qualifications.id, title: qualifications.title })
          .from(qualifications)
          .where(eq(qualifications.qctoCode, details.qctoCode!));
        return row ?? null;
      })
    : null;

  const outcomes = registration?.exitLevelOutcomes ?? [];

  return {
    details,
    modules: curriculum.modules.map(summarise),
    exitLevelOutcomes: outcomes,
    notes,
    totals: {
      ...totalsOf(curriculum),
      exitLevelOutcomes: outcomes.length,
      associatedCriteria: outcomes.reduce((n, e) => n + e.criteria.length, 0),
    },
    supplied: {
      curriculum: true,
      qualification: Boolean(documents.qualification),
      assessmentSpecification: Boolean(documents.assessmentSpecification),
    },
    existing,
  };
}

function summarise(module: ParsedCurriculum["modules"][number]): ModuleSummary {
  return {
    code: module.code,
    component: module.component,
    title: module.title,
    credits: module.credits,
    topics: module.topics.length,
    elements: module.topics.reduce((n, topic) => n + topic.elements.length, 0),
    criteria: module.topics.reduce((n, topic) => n + topic.criteria.length, 0),
  };
}

function totalsOf(parsed: ParsedCurriculum) {
  return {
    modules: parsed.modules.length,
    topics: parsed.modules.reduce((n, m) => n + m.topics.length, 0),
    elements: parsed.modules.reduce(
      (n, m) => n + m.topics.reduce((t, topic) => t + topic.elements.length, 0),
      0,
    ),
    criteria: parsed.modules.reduce(
      (n, m) => n + m.topics.reduce((t, topic) => t + topic.criteria.length, 0),
      0,
    ),
  };
}

export type ConfirmedDetails = {
  title: string;
  qctoCode?: string;
  saqaId?: string;
  nqfLevel?: number;
  totalCredits?: number;
};

/**
 * Writes the qualification, its outcomes and its whole curriculum, then files
 * every document that produced it.
 *
 * The documents are kept rather than used and discarded: everything below was
 * read out of them, and a moderator asking where a criterion came from should
 * be able to open the source. Filing them is also what satisfies the readiness
 * gate, so a qualification created this way is ready for material immediately.
 */
export async function createQualificationFromDocuments(
  session: AuthenticatedSession,
  documents: SourceDocuments,
  confirmed: ConfirmedDetails,
): Promise<{ qualificationId: string; summary: ImportSummary }> {
  assertSessionCan(session, "qualification:manage");

  // Read again rather than trusting what came back from the browser. The
  // curriculum is what the file says, not what a form could be edited to
  // claim; only the handful of header fields are the person's to correct.
  const reading = await readQualificationSources(session, documents);

  if (reading.existing) {
    throw new QualificationImportError(
      `"${reading.existing.title}" already carries the code ${reading.details.qctoCode}. Importing again here would replace its whole curriculum, and anything tagged to a criterion would go with it. Open that qualification instead.`,
      "already_exists",
    );
  }

  const curriculum = parseCurriculumText(
    await readOrExplain(documents.curriculum),
  );

  const dropped: string[] = [];

  const curriculumFile: CurriculumFileInput = {
    title: confirmed.title,
    qctoCode: confirmed.qctoCode || undefined,
    saqaId: confirmed.saqaId || undefined,
    nqfLevel: confirmed.nqfLevel,
    totalCredits: confirmed.totalCredits,
    exitLevelOutcomes: reading.exitLevelOutcomes.map((outcome) => ({
      number: outcome.number,
      description: outcome.description,
      criteria: outcome.criteria,
    })),
    modules: curriculum.modules.map((module) => {
      // A criterion code has to be unique within its module, and an element
      // code within its topic. The real documents break both: 121150 restarts
      // its criteria at IAC0101 in a second topic of KM02, and numbers five
      // different work activities WA0201. Only the first of each can be
      // stored, so the rest are dropped here and named in the result — the
      // alternative is the whole import failing on a constraint, which loses
      // four hundred good lines over a numbering slip.
      const seenCriteria = new Set<string>();

      return {
        component: module.component,
        code: module.code,
        title: module.title,
        credits: module.credits ?? undefined,
        nqfLevel: module.nqfLevel ?? undefined,
        topics: module.topics.map((topic) => {
          const seenElements = new Set<string>();

          const elements = topic.elements.filter((element) => {
            if (seenElements.has(element.code)) {
              dropped.push(
                `${module.code} / ${topic.code}: a second ${element.code}`,
              );
              return false;
            }
            seenElements.add(element.code);
            return true;
          });

          const criteria = topic.criteria.filter((criterion) => {
            if (seenCriteria.has(criterion.code)) {
              dropped.push(`${module.code}: a second ${criterion.code}`);
              return false;
            }
            seenCriteria.add(criterion.code);
            return true;
          });

          return {
            code: topic.code,
            title: topic.title,
            weightPercent: topic.weightPercent ?? undefined,
            elements: elements.map((element) => ({
              kind: element.kind,
              code: element.code,
              description: element.description,
            })),
            criteria: criteria.map((criterion) => ({
              code: criterion.code,
              description: criterion.description,
            })),
          };
        }),
      };
    }),
  };

  const imported = await importCurriculum(session, curriculumFile);

  // Filed after the import rather than before, because a document attached to
  // a qualification that then failed to import would be a record of something
  // that does not exist.
  const filings: [SourceFile | null | undefined, string, string][] = [
    [documents.curriculum, "curriculum_document", "Curriculum Document"],
    [documents.qualification, "qualification_document", "Qualification Document"],
    [
      documents.assessmentSpecification,
      "assessment_specification",
      "Assessment Specification",
    ],
  ];

  const unfiled: string[] = [];

  for (const [file, kind, title] of filings) {
    if (!file) continue;
    try {
      await uploadProgrammeDocument(
        session,
        {
          kind: kind as "curriculum_document",
          title,
          qualificationId: imported.qualificationId,
        },
        file,
      );
    } catch (error) {
      // The curriculum is already written and correct; a document that would
      // not file is worth reporting rather than unwinding all of it.
      unfiled.push(
        `${title} was not filed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const summary: ImportSummary = {
    ...imported,
    warnings: [
      ...imported.warnings,
      ...unfiled,
      ...(dropped.length > 0
        ? [
            `${dropped.length} ${dropped.length === 1 ? "line was" : "lines were"} not imported because the document reuses a code where the platform needs a unique one: ${dropped.join("; ")}. Add them by hand with their own codes, or have the document renumbered.`,
          ]
        : []),
    ],
  };

  return { qualificationId: imported.qualificationId, summary };
}
