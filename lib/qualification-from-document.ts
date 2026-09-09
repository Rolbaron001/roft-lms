import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { curriculumModules, qualifications } from "@/db/schema";
import { readPdfText, readDocxText, OfficeReadError } from "./office";
import {
  parseCurriculumText,
  type ParsedCurriculum,
  type ParsedQualification,
} from "./curriculum-parse";
import {
  moduleKey,
  parseQualificationDocument,
  type ParsedExitLevelOutcome,
} from "./qualification-document-parse";
import { createQualification, listCurriculumModules } from "./authoring";
import { selectModules } from "./part-qualifications";
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
  details: ParsedQualification & {
    saqaId: string | null;
    /**
     * What the SAQA document says this is. "full" when no SAQA document was
     * supplied, because a folder of curriculum material with nothing to say
     * otherwise is a full qualification.
     */
    kind: "full" | "part" | "skills_programme";
  };
  /**
   * For a part: the full qualification it will be attached to, and which of
   * that qualification's modules its own document lists.
   *
   * Null for a full qualification. Also null for a part whose parent has not
   * been imported yet - which is not a failure, but it does mean the part
   * cannot be created until the parent is, and `notes` says so.
   */
  part: {
    parent: { id: string; title: string };
    /** Matched against the parent's curriculum, so a missed code shows here. */
    modules: { code: string; found: boolean }[];
  } | null;
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

  // Judged on content rather than on headings. The registration document names
  // the same fifteen modules the curriculum does — that is what it is for — so
  // "did any module header appear" cannot tell the two apart, and once the
  // reader stopped requiring an exact header format it stopped trying to.
  //
  // What separates them is that a curriculum document says what is inside a
  // module. Fifteen module names with nothing under any of them is the wrong
  // file, whatever it calls itself.
  const withContent = curriculum.modules.filter(
    (entry) => entry.topics.length > 0,
  );

  if (withContent.length === 0) {
    const named = curriculum.modules.length;
    throw new QualificationImportError(
      `No curriculum modules were found in "${documents.curriculum.filename}". ` +
        (named > 0
          ? `It names ${named} module${named === 1 ? "" : "s"} but sets out no topics or assessment criteria for any of them, which is what the Qualification Document looks like. `
          : "") +
        "Check it is the Curriculum Document rather than the Qualification Document or the Assessment Specification.",
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
    // Only the SAQA document states this. Without one, a folder of curriculum
    // material is a full qualification - which is what every import did before
    // this field existed, so the default changes nothing already working.
    kind: registration?.kind ?? "full",
    title: registration?.title ?? curriculum.qualification.title,
    // The curriculum document is the first authority on its own code, but it
    // does not always print one the reader can find - Commercial Cleaner's does
    // not. The SAQA document states it in a sentence ("The curriculum title and
    // code are: Commercial Cleaner: 811201-000-00.") and is the fallback.
    curriculumCode:
      curriculum.qualification.curriculumCode ??
      registration?.curriculumCode ??
      null,
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

  const existing = details.curriculumCode
    ? await withTenant(session.organisationId, async (tx) => {
        const [row] = await tx
          .select({ id: qualifications.id, title: qualifications.title })
          .from(qualifications)
          // The curriculum belongs to the full qualification; a part
          // shares the code without owning it.
          .where(
            and(
              eq(qualifications.curriculumCode, details.curriculumCode!),
              eq(qualifications.kind, "full"),
            ),
          );
        return row ?? null;
      })
    : null;

  /**
   * A part qualification is attached to the qualification that already carries
   * this curriculum code, and takes the modules its own document lists.
   *
   * `existing` finding something is the ordinary case here rather than a
   * clash: 118710's curriculum document is byte-identical to 118709's, so a
   * part is imported from the parent's own curriculum and the match is how the
   * parent is found at all.
   */
  let part: DocumentReading["part"] = null;

  if (details.kind !== "full") {
    /**
     * A part is attached by its module codes, not by its own curriculum code.
     *
     * The real documents settle this. 118709 states its curriculum code as
     * 811201-000-00 and 118710 states 811201-000-01 - the numeric suffix - so
     * the two headers do not match and never will. But every module 118710
     * lists is written 811201-000-00-KM-01: the parent's prefix, because they
     * are the parent's modules.
     */
    const parentCode = registration?.parentCurriculumCode ?? null;

    const parent = parentCode
      ? await withTenant(session.organisationId, async (tx) => {
          const [row] = await tx
            .select({ id: qualifications.id, title: qualifications.title })
            .from(qualifications)
            .where(
              and(
                eq(qualifications.curriculumCode, parentCode),
                eq(qualifications.kind, "full"),
              ),
            );
          return row ?? null;
        })
      : existing;

    if (!parent) {
      notes.push(
        "This is a part qualification, but the full qualification it comes from is not on the platform yet. Import that one first — a part carries no curriculum of its own, so there is nothing to attach it to until the parent exists.",
      );
    } else {
      /**
       * Matched on the component and number alone, because the two documents
       * write the same module differently. The SAQA document says
       * "811201-000-00-KM-01"; the curriculum document, which is where the
       * platform's modules come from, says "KM01". Comparing them whole finds
       * nothing, every time.
       */
      const inParent = new Set(
        (
          await withTenant(session.organisationId, (tx) =>
            tx
              .select({ code: curriculumModules.code })
              .from(curriculumModules)
              .where(eq(curriculumModules.qualificationId, parent.id)),
          )
        ).map((entry) => moduleKey(entry.code)),
      );

      const listed = registration?.moduleCodes ?? [];

      part = {
        parent,
        modules: listed.map((code) => ({
          code,
          found: inParent.has(moduleKey(code)),
        })),
      };

      const missing = part.modules.filter((entry) => !entry.found);
      if (listed.length === 0) {
        notes.push(
          "Its Qualification Rules section named no modules, so nothing can be selected automatically. Choose them by hand once it exists.",
        );
      } else if (missing.length > 0) {
        notes.push(
          `${missing.length} of the ${listed.length} modules its document lists were not found in the parent's curriculum: ${missing.map((entry) => entry.code).join(", ")}. The rest will be selected; check these by hand.`,
        );
      }
    }
  }

  const outcomes = registration?.exitLevelOutcomes ?? [];

  return {
    details,
    part,
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
  curriculumCode?: string;
  saqaId?: string;
  nqfLevel?: number;
  totalCredits?: number;
};

/**
 * Creates a part qualification against the parent that already holds the
 * curriculum, and records which of its modules the part takes.
 *
 * Nothing curricular is written. The only new rows are the qualification
 * itself and its module selection, which is the whole difference between a
 * part and a full qualification: it is a subset of something that already
 * exists, not a thing of its own.
 *
 * Its SAQA document is filed against it, because that document is the part's
 * alone - it states its own SAQA ID, its own credit total and its own module
 * list. The curriculum document and the assessment specification are not: they
 * are the parent's, byte for byte, and filing a second copy under the part
 * would suggest there were two.
 */
async function createPartFromDocuments(
  session: AuthenticatedSession,
  documents: SourceDocuments,
  confirmed: ConfirmedDetails,
  reading: DocumentReading,
): Promise<{ qualificationId: string; summary: ImportSummary }> {
  const part = reading.part!;

  const created = await createQualification(session, {
    title: confirmed.title,
    kind: reading.details.kind === "part" ? "part" : "skills_programme",
    parentQualificationId: part.parent.id,
    curriculumCode: confirmed.curriculumCode || undefined,
    saqaId: confirmed.saqaId || undefined,
    nqfLevel: confirmed.nqfLevel,
    totalCredits: confirmed.totalCredits,
  });

  const wanted = part.modules
    .filter((entry) => entry.found)
    .map((entry) => entry.code);

  const parentModules = await listCurriculumModules(session, part.parent.id);
  const byCode = new Map(
    parentModules.map((entry) => [moduleKey(entry.code), entry.id]),
  );

  const ids = wanted
    .map((code) => byCode.get(moduleKey(code)))
    .filter((id): id is string => Boolean(id));

  if (ids.length > 0) {
    await selectModules(session, created.id, ids);
  }

  const warnings: string[] = [...reading.notes];

  if (documents.qualification) {
    try {
      await uploadProgrammeDocument(
        session,
        {
          kind: "qualification_document",
          title: "Qualification Document",
          qualificationId: created.id,
        },
        documents.qualification,
      );
    } catch (error) {
      warnings.push(
        `The Qualification Document was not filed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return {
    qualificationId: created.id,
    summary: {
      qualificationId: created.id,
      created: true,
      exitLevelOutcomes: 0,
      studyUnits: 0,
      modules: ids.length,
      topics: 0,
      elements: 0,
      criteria: 0,
      warnings: [
        `Created as a part of "${part.parent.title}", taking ${ids.length} of its ${parentModules.length} modules. Its curriculum is the parent's — nothing was copied, so a learner's work against a module counts once wherever they met it.`,
        ...warnings,
      ],
    },
  };
}

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

  /**
   * A part qualification takes a different path entirely: nothing is imported.
   *
   * Its curriculum document is the parent's - the same file, filed twice - so
   * reading it in again would produce a second copy of one curriculum, two
   * ledgers where a criterion is marked complete, and a learner who did the
   * work under one qualification getting no credit for it under the other.
   * What is created instead is the part itself and the list of which of the
   * parent's modules it takes.
   */
  if (reading.part) {
    return createPartFromDocuments(session, documents, confirmed, reading);
  }

  if (reading.details.kind !== "full") {
    throw new QualificationImportError(
      `Its document says this is a ${reading.details.kind === "part" ? "part qualification" : "skills programme"}, but the full qualification it comes from is not on the platform. Import that one first — this one shares its curriculum and has none of its own.`,
      "not_a_curriculum",
    );
  }

  if (reading.existing) {
    throw new QualificationImportError(
      `"${reading.existing.title}" already carries the code ${reading.details.curriculumCode}. Importing again here would replace its whole curriculum, and anything tagged to a criterion would go with it. Open that qualification instead.`,
      "already_exists",
    );
  }

  const curriculum = parseCurriculumText(
    await readOrExplain(documents.curriculum),
  );

  const dropped: string[] = [];

  const curriculumFile: CurriculumFileInput = {
    title: confirmed.title,
    curriculumCode: confirmed.curriculumCode || undefined,
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
