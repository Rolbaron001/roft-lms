import { eq, inArray } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  criterionAlignment,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  qualifications,
  topicElementAlignment,
} from "@/db/schema";
import { readXlsxSheets, type Sheet } from "./office";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { modulesOfCondition } from "./part-qualifications";

/**
 * Reading a provider's Curriculum Alignment Matrix.
 *
 * This is the document an accreditation visit asks for first: one row per
 * curriculum line, and against it the workbook that teaches it, the
 * assessment that tests it, the handbook chapter it lives in, and the
 * standards, policies and legislation it draws on. Providers maintain it in
 * Excel and will carry on doing so: it is a planning surface, and a
 * spreadsheet is a good one.
 *
 * What the platform gets from reading it is the ability to answer "what covers
 * KM0201" and "what assesses IAC0101" without anyone opening the file, and to
 * notice when the matrix refers to a curriculum line that does not exist.
 *
 * Extended on 26 September (job sheet W2). Roland: the platform reads
 * alignment matrices of this shape, from any provider, to check coverage; and
 * it holds what the provider wants loaded, after they confirm it at upload.
 * Curiosa's 121151 matrix has three sheets (knowledge, practical, workplace),
 * names each row's module and topic, gives the criterion a row serves, and
 * says where each row came from: 112 criteria published by the QCTO, nine the
 * provider constructed, each citing the design decision behind it.
 *
 * The columns are read from the header row rather than by position, because
 * every provider's matrix has a different set.
 */

export class AlignmentMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlignmentMatrixError";
  }
}

type ResourceKind =
  | "workbook"
  | "summative_assessment"
  | "theory_guide"
  | "video"
  | "standard"
  | "legislation"
  | "national_document"
  | "article"
  | "policy"
  | "industry_document"
  | "code_of_good_practice"
  | "other";

/**
 * Header text to resource kind, matched loosely on purpose. "Curiosa Theory
 * Guide", "Theory Guide" and "Learner Handbook" are the same column wearing
 * three providers' names.
 *
 * A simulation is how a practical skill is assessed, so it is filed as the
 * summative instrument it is; the scorecard line that sits beside it is detail
 * of the same instrument and is not a second one.
 */
const HEADER_PATTERNS: { pattern: RegExp; kind: ResourceKind }[] = [
  { pattern: /work\s*book/i, kind: "workbook" },
  { pattern: /simulation/i, kind: "summative_assessment" },
  { pattern: /summative|assignment|assessment/i, kind: "summative_assessment" },
  { pattern: /theory\s*guide|handbook|learner\s*guide/i, kind: "theory_guide" },
  { pattern: /video/i, kind: "video" },
  { pattern: /standard/i, kind: "standard" },
  { pattern: /legislat|\bact\b|regulation/i, kind: "legislation" },
  { pattern: /national\s*doc|national\s*app/i, kind: "national_document" },
  { pattern: /article/i, kind: "article" },
  { pattern: /polic/i, kind: "policy" },
  { pattern: /industry/i, kind: "industry_document" },
  { pattern: /cogp|good\s*practice/i, kind: "code_of_good_practice" },
];

/** What assesses a criterion, as opposed to what teaches it. */
export const ASSESSING_KINDS = new Set<ResourceKind>(["workbook", "summative_assessment"]);

/** What teaches a line. A workbook both teaches and assesses. */
export const TEACHING_KINDS = new Set<ResourceKind>(["theory_guide", "workbook", "video"]);

/**
 * The column holding the curriculum lines this row is about.
 *
 * Anchored to the start of the cell: a heading begins with what it names. A
 * sentence that merely mentions topic elements, such as a reconciliation
 * check "Published topic elements in blueprint", is not a heading.
 */
const ELEMENT_HEADER =
  /^\s*(?:topic\s*elements?|practical\s*application|skills?\s*activit|work\s*activit)/i;

/** Columns that name the row's place in the curriculum. */
const MODULE_HEADER = /^\s*module\b/i;
const TOPIC_HEADER = /^\s*(?:topic|practical\s*skill|experience)\s*$/i;
const CRITERIA_HEADER = /criteri/i;
const PROVENANCE_HEADER = /provenance|source\s*of/i;

/**
 * Columns that describe the curriculum rather than pointing at a resource.
 *
 * Checked before the patterns below, because "Internal Assessment Criteria"
 * contains the word "assessment" and would otherwise be filed as the summative
 * assessment that covers the row.
 */
const NOT_A_RESOURCE =
  /criteri|^\s*elo\s*$|^\s*module|^\s*topic|^\s*#|^\s*no\.?\s*$|^\s*row\s*$|provenance|scorecard|condition|^\s*marks?\s*$|lms\s*object/i;

export type MatrixRow = {
  /** Codes found in the elements column: KT0101, PS0101, WA0101 … */
  elementCodes: string[];
  resources: { kind: ResourceKind; reference: string }[];
  /** The module the row names, as a bare code: "KM01". Null when no column. */
  moduleCode: string | null;
  /** The topic the row names, where there is a column for it. */
  topic: { code: string; title: string; weightPercent: number | null } | null;
  /** Element text by code, for adding a line the curriculum does not have. */
  elements: { code: string; description: string }[];
  /** Criteria the row serves, with their wording where the cell gives it. */
  criteria: { code: string; description: string }[];
  /** Where the row came from, in the provider's words. */
  provenance: string | null;
};

export type SheetReading = {
  sheetName: string;
  headerRow: number;
  columns: { index: number; header: string; kind: ResourceKind }[];
  rows: MatrixRow[];
};

/**
 * The first sheet's reading at the top level, as before, and every sheet with
 * a column of curriculum lines under `sheets`.
 */
export type MatrixReading = SheetReading & { sheets: SheetReading[] };

/** Any code of the form two letters then four digits, as the documents use. */
function codesIn(cell: string): string[] {
  return [...cell.matchAll(/\b([A-Z]{2}\d{4})\b/g)].map((match) => match[1]);
}

/** "242303-001-00-KM-01 Creating ..." or "WM-01 ..." to "KM01". */
function moduleCodeIn(cell: string): string | null {
  const matches = [...cell.matchAll(/\b([A-Z]{2})-?(\d{2})(?!\d)/g)];
  const last = matches.at(-1);
  return last ? `${last[1]}${last[2]}` : null;
}

/** A module's stored code in the same bare form, "KM-01" and "KM01" alike. */
function bareModuleCode(code: string): string {
  const match = /([A-Z]{2})-?(\d{2})(?!\d)/.exec(code.toUpperCase());
  return match ? `${match[1]}${match[2]}` : code.toUpperCase();
}

/**
 * Entries in a cell: "KT0101 Definitions..." on one line, or "IAC0101; IAC0102"
 * as a list. Each is a code and whatever wording follows it.
 */
function entriesIn(cell: string): { code: string; description: string }[] {
  return cell
    .split(/[\n;]+/)
    .map((part) => part.trim())
    .map((part) => /^([A-Z]{2,3}\d{4})[:.]?\s*(.*)$/.exec(part))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ code: match[1], description: match[2].trim() }));
}

/**
 * Splits a cell into separate references.
 *
 * A resource cell holds one value more often than several, but "SA2, SA3" and
 * a cell with three lines both happen. Splitting on commas would break
 * "Chapter 2, section 4", so only newlines and semicolons separate.
 */
function referencesIn(cell: string): string[] {
  return cell
    .split(/[\n;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 200);
}

function isElementHeading(cell: string): boolean {
  return ELEMENT_HEADER.test(cell);
}

/**
 * The header row: a heading of curriculum lines with at least one other
 * heading beside it, a module, a topic, the criteria or a resource.
 *
 * Curiosa's reconciliation sheet has lines such as "Topic elements with no
 * criterion | 0 | 0 | Match": they begin like a heading, but what sits beside
 * them is figures, not other headings. Found on 26 September, when that sheet
 * was read as a fourth part of the matrix.
 */
function findHeaderRow(sheet: Sheet): number {
  const otherHeading = (cell: string) =>
    !isElementHeading(cell) &&
    (MODULE_HEADER.test(cell) ||
      TOPIC_HEADER.test(cell) ||
      CRITERIA_HEADER.test(cell) ||
      HEADER_PATTERNS.some((entry) => entry.pattern.test(cell)));
  return sheet.rows.findIndex(
    (row) => row.some(isElementHeading) && row.some(otherHeading),
  );
}

/**
 * Whether these bytes are a Word document rather than a workbook.
 *
 * Both are zip files, and they are told apart by what is inside: a Word
 * document carries word/document.xml, a workbook carries xl/workbook.xml.
 */
function looksLikeWord(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  return head.includes("word/document.xml") || head.includes("word/_rels");
}

function readSheet(sheet: Sheet, headerRow: number): SheetReading {
  const header = sheet.rows[headerRow];
  const find = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));

  const elementColumn = header.findIndex(isElementHeading);
  const moduleColumn = find(MODULE_HEADER);
  const topicColumn = find(TOPIC_HEADER);
  const criteriaColumn = find(CRITERIA_HEADER);
  const provenanceColumn = find(PROVENANCE_HEADER);
  const weightColumn = find(/weight/i);

  const columns = header
    .map((cell, index) => {
      if (index === elementColumn || !cell.trim()) return null;
      if (NOT_A_RESOURCE.test(cell)) return null;
      const match = HEADER_PATTERNS.find((entry) => entry.pattern.test(cell));
      return match ? { index, header: cell, kind: match.kind } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const rows: MatrixRow[] = [];
  const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");

  for (const row of sheet.rows.slice(headerRow + 1)) {
    const elementCodes = codesIn(cell(row, elementColumn));
    const criteria = entriesIn(cell(row, criteriaColumn)).filter((entry) =>
      /^IAC/i.test(entry.code),
    );
    if (elementCodes.length === 0 && criteria.length === 0) continue;

    const resources = columns.flatMap((column) =>
      referencesIn(row[column.index] ?? "").map((reference) => ({
        kind: column.kind,
        reference,
      })),
    );

    const topicCell = cell(row, topicColumn);
    const topicMatch = /^([A-Z]{2}\d{4})[:.]?\s*(.*)$/.exec(topicCell);
    const weight = Number.parseInt(cell(row, weightColumn), 10);

    rows.push({
      elementCodes,
      resources,
      moduleCode: moduleColumn >= 0 ? moduleCodeIn(cell(row, moduleColumn)) : null,
      topic: topicMatch
        ? {
            code: topicMatch[1],
            title: topicMatch[2].trim(),
            weightPercent: Number.isFinite(weight) ? weight : null,
          }
        : null,
      elements: entriesIn(cell(row, elementColumn)),
      criteria,
      provenance: cell(row, provenanceColumn) || null,
    });
  }

  return { sheetName: sheet.name, headerRow: headerRow + 1, columns, rows };
}

/**
 * Reads the matrix without touching the database, so a file can be checked
 * before it is trusted.
 */
export function readAlignmentMatrix(bytes: Uint8Array): MatrixReading {
  /*
   * A Word document handed to a spreadsheet reader. Curiosa's alignment
   * document is a Word table, and Heidi uploaded exactly this during the test
   * on 16 September. Checked by looking inside rather than by trusting the
   * extension.
   */
  if (looksLikeWord(bytes)) {
    throw new AlignmentMatrixError(
      "That is a Word document. The document itself is kept, filed and searchable - what could not happen is reading it, because the alignment matrix is read as a spreadsheet: one row per curriculum line, with a column headed something like “Topic Elements”. Save the matrix as a spreadsheet and upload that as well, and each line of the curriculum will show what covers it.",
    );
  }

  const sheets = readXlsxSheets(bytes)
    .map((sheet) => ({ sheet, headerRow: findHeaderRow(sheet) }))
    .filter((candidate) => candidate.headerRow !== -1)
    .map(({ sheet, headerRow }) => readSheet(sheet, headerRow))
    // A sheet whose rows name no curriculum line is not part of the matrix,
    // whatever its headings say. Curiosa's reconciliation sheet has a check
    // called "Published topic elements in blueprint", which reads as a header.
    .filter((reading) => reading.rows.length > 0);

  if (sheets.length === 0) {
    throw new AlignmentMatrixError(
      "No alignment matrix found in this workbook. One column must be headed something like “Topic Elements”, so the rows can be matched to the curriculum.",
    );
  }

  if (sheets.every((sheet) => sheet.columns.length === 0)) {
    throw new AlignmentMatrixError(
      "The matrix has no resource columns that could be recognised — nothing headed Workbook, Assessment, Theory Guide, Legislation and so on.",
    );
  }

  return { ...sheets[0], sheets };
}

// ---------------------------------------------------------------------------
// Matching the matrix to the curriculum
// ---------------------------------------------------------------------------

/**
 * Something the matrix names that the curriculum as held does not have.
 *
 * Proposed, never added on reading. Roland, 26 September: hold what the
 * provider wants loaded, after they confirm it during the upload. The key is
 * what the confirmation posts back.
 */
export type ProposedAddition = {
  key: string;
  kind: "topic" | "element" | "criterion";
  moduleCode: string;
  topicCode: string;
  code: string;
  description: string;
  /** Why it is offered, in the provider's words where the matrix gives any. */
  reason: string;
};

export type MatrixImportSummary = {
  sheetName: string;
  sheetsRead: string[];
  columnsRecognised: string[];
  rowsRead: number;
  elementsMatched: number;
  criteriaMatched: number;
  alignmentsRecorded: number;
  /**
   * Codes the matrix refers to that the curriculum does not contain, where
   * there is no module to place them in. Usually a module nobody has
   * transcribed yet, occasionally a typo.
   */
  unmatchedCodes: string[];
  /** Lines the provider can choose to add. Empty once confirmed. */
  proposedAdditions: ProposedAddition[];
  /** How many were added by this reading. */
  added: number;
};

type Curriculum = {
  modules: { id: string; code: string; bare: string; component: string }[];
  topics: { id: string; moduleId: string; code: string }[];
  elements: { id: string; topicId: string; code: string }[];
  criteria: { id: string; moduleId: string; topicId: string | null; code: string }[];
};

async function loadCurriculum(tx: TenantDatabase, qualificationId: string): Promise<Curriculum> {
  const [entry] = await tx
    .select({ parentId: qualifications.parentQualificationId })
    .from(qualifications)
    .where(eq(qualifications.id, qualificationId));

  const modules = await tx
    .select({
      id: curriculumModules.id,
      code: curriculumModules.code,
      component: curriculumModules.component,
    })
    .from(curriculumModules)
    .where(modulesOfCondition(qualificationId, entry?.parentId ?? null));

  const moduleIds = modules.map((m) => m.id);
  const topics = moduleIds.length
    ? await tx
        .select({
          id: curriculumTopics.id,
          moduleId: curriculumTopics.curriculumModuleId,
          code: curriculumTopics.code,
        })
        .from(curriculumTopics)
        .where(inArray(curriculumTopics.curriculumModuleId, moduleIds))
    : [];
  const elements = topics.length
    ? await tx
        .select({
          id: curriculumTopicElements.id,
          topicId: curriculumTopicElements.topicId,
          code: curriculumTopicElements.code,
        })
        .from(curriculumTopicElements)
        .where(inArray(curriculumTopicElements.topicId, topics.map((t) => t.id)))
    : [];
  const criteria = moduleIds.length
    ? await tx
        .select({
          id: assessmentCriteria.id,
          moduleId: assessmentCriteria.curriculumModuleId,
          topicId: assessmentCriteria.topicId,
          code: assessmentCriteria.code,
        })
        .from(assessmentCriteria)
        .where(inArray(assessmentCriteria.curriculumModuleId, moduleIds))
    : [];

  return {
    modules: modules.map((m) => ({ ...m, bare: bareModuleCode(m.code) })),
    topics,
    elements,
    criteria,
  };
}

const ELEMENT_KIND_BY_COMPONENT: Record<string, "knowledge_topic" | "practical_activity" | "work_activity"> = {
  knowledge: "knowledge_topic",
  practical: "practical_activity",
  workplace: "work_activity",
};

function reasonFor(provenance: string | null): string {
  if (!provenance) return "In the matrix, not in the curriculum as read.";
  if (/^published/i.test(provenance)) {
    return "The matrix says the curriculum publishes this; the curriculum as read does not have it.";
  }
  return provenance;
}

type Matched = {
  elementAlignments: { topicElementId: string; kind: ResourceKind; reference: string }[];
  criterionAlignments: { criterionId: string; kind: ResourceKind; reference: string }[];
  elementsMatched: Set<string>;
  criteriaMatched: Set<string>;
  unmatched: Set<string>;
  proposals: Map<string, ProposedAddition & { moduleId: string; weightPercent: number | null; component: string; addedFrom: string }>;
  rowsRead: number;
};

/**
 * Where each row belongs, and what it names that is missing.
 *
 * A row that names its module is matched within that module, because codes
 * repeat: every module has a KT0101 and an IAC0101. A matrix with no module
 * column is matched as before, by code across the qualification, and a code
 * found in several modules is recorded against all of them rather than
 * dropped.
 */
function match(reading: MatrixReading, curriculum: Curriculum): Matched {
  const result: Matched = {
    elementAlignments: [],
    criterionAlignments: [],
    elementsMatched: new Set(),
    criteriaMatched: new Set(),
    unmatched: new Set(),
    proposals: new Map(),
    rowsRead: 0,
  };

  for (const sheet of reading.sheets) {
    for (const row of sheet.rows) {
      result.rowsRead += 1;
      const home = row.moduleCode
        ? curriculum.modules.find((m) => m.bare === row.moduleCode)
        : null;

      // Without a module to place a row in, fall back to matching by code
      // alone, and propose nothing: there is nowhere to add it.
      if (!home) {
        for (const code of row.elementCodes) {
          const found = curriculum.elements.filter((e) => e.code === code);
          if (found.length === 0) result.unmatched.add(code);
          for (const element of found) {
            result.elementsMatched.add(element.id);
            for (const resource of row.resources) {
              result.elementAlignments.push({ topicElementId: element.id, ...resource });
            }
          }
        }
        continue;
      }

      const topicCode = row.topic?.code ?? null;
      const topic = topicCode
        ? curriculum.topics.find((t) => t.moduleId === home.id && t.code === topicCode)
        : null;
      const reason = reasonFor(row.provenance);
      const addedFrom = `Alignment matrix: ${row.provenance ?? "not in the curriculum document"}`;
      const propose = (
        kind: ProposedAddition["kind"],
        code: string,
        description: string,
      ) => {
        const key = `${kind}|${home.id}|${topicCode ?? ""}|${code}`;
        if (result.proposals.has(key)) return;
        result.proposals.set(key, {
          key,
          kind,
          moduleCode: home.code,
          topicCode: topicCode ?? "",
          code,
          description,
          reason,
          moduleId: home.id,
          weightPercent: row.topic?.weightPercent ?? null,
          component: home.component,
          addedFrom,
        });
      };

      if (topicCode && !topic) {
        propose("topic", topicCode, row.topic?.title ?? "");
      }

      const topicIds = topic
        ? [topic.id]
        : curriculum.topics.filter((t) => t.moduleId === home.id).map((t) => t.id);

      for (const code of row.elementCodes) {
        const found = curriculum.elements.filter(
          (e) => e.code === code && (topic ? e.topicId === topic.id : topicIds.includes(e.topicId)),
        );
        if (found.length === 0) {
          if (topicCode) {
            const text = row.elements.find((e) => e.code === code)?.description ?? "";
            propose("element", code, text);
          } else {
            result.unmatched.add(code);
          }
          continue;
        }
        for (const element of found) {
          result.elementsMatched.add(element.id);
          for (const resource of row.resources) {
            result.elementAlignments.push({ topicElementId: element.id, ...resource });
          }
        }
      }

      for (const criterion of row.criteria) {
        const found = curriculum.criteria.filter(
          (c) =>
            c.moduleId === home.id &&
            c.code === criterion.code &&
            (topic ? c.topicId === topic.id || c.topicId === null : true),
        );
        if (found.length === 0) {
          if (topicCode && criterion.description) {
            propose("criterion", criterion.code, criterion.description);
          } else if (!topicCode) {
            result.unmatched.add(criterion.code);
          }
          continue;
        }
        for (const one of found) {
          result.criteriaMatched.add(one.id);
          for (const resource of row.resources) {
            result.criterionAlignments.push({ criterionId: one.id, ...resource });
          }
        }
      }
    }
  }

  return result;
}

/**
 * Records what the matrix says against the curriculum already imported, and
 * adds whichever proposed lines the provider has confirmed.
 *
 * Called twice in the ordinary course of things: once on upload, with nothing
 * confirmed, which records what matches and returns what could be added; and
 * again when the provider ticks what they want, which adds it and records its
 * coverage too.
 *
 * The recorded alignment is replaced rather than added to. A matrix is a
 * statement of what covers the curriculum now; merging an old reading with a
 * new one would leave a withdrawn workbook listed forever.
 */
export async function importAlignmentMatrix(
  session: AuthenticatedSession,
  qualificationId: string,
  bytes: Uint8Array,
  confirmed: string[] = [],
): Promise<MatrixImportSummary> {
  assertSessionCan(session, "qualification:manage");
  const reading = readAlignmentMatrix(bytes);

  return withTenant(session.organisationId, async (tx) => {
    let curriculum = await loadCurriculum(tx, qualificationId);

    if (curriculum.modules.length === 0) {
      throw new AlignmentMatrixError(
        "Import the curriculum document before the alignment matrix — there is nothing yet for its rows to attach to.",
      );
    }

    let matched = match(reading, curriculum);

    // Add what was confirmed, topics first so their elements and criteria
    // have somewhere to go, then read the matrix again against the fuller
    // curriculum so the added lines have their coverage recorded as well.
    const wanted = new Set(confirmed);
    const chosen = [...matched.proposals.values()].filter((p) => wanted.has(p.key));
    let added = 0;

    for (const proposal of chosen.filter((p) => p.kind === "topic")) {
      const inserted = await tx
        .insert(curriculumTopics)
        .values({
          organisationId: session.organisationId,
          curriculumModuleId: proposal.moduleId,
          code: proposal.code,
          title: proposal.description || proposal.code,
          weightPercent: proposal.weightPercent,
          addedFrom: proposal.addedFrom,
          sortOrder: 1000,
        })
        .onConflictDoNothing()
        .returning({ id: curriculumTopics.id });
      added += inserted.length;
    }
    if (chosen.some((p) => p.kind === "topic")) curriculum = await loadCurriculum(tx, qualificationId);

    const topicId = (moduleId: string, code: string) =>
      curriculum.topics.find((t) => t.moduleId === moduleId && t.code === code)?.id ?? null;

    for (const proposal of chosen.filter((p) => p.kind === "element")) {
      const topic = topicId(proposal.moduleId, proposal.topicCode);
      if (!topic) continue;
      const inserted = await tx
        .insert(curriculumTopicElements)
        .values({
          organisationId: session.organisationId,
          topicId: topic,
          kind: ELEMENT_KIND_BY_COMPONENT[proposal.component] ?? "knowledge_topic",
          code: proposal.code,
          description: proposal.description || proposal.code,
          addedFrom: proposal.addedFrom,
          sortOrder: 1000,
        })
        .onConflictDoNothing()
        .returning({ id: curriculumTopicElements.id });
      added += inserted.length;
    }

    for (const proposal of chosen.filter((p) => p.kind === "criterion")) {
      const topic = topicId(proposal.moduleId, proposal.topicCode);
      const inserted = await tx
        .insert(assessmentCriteria)
        .values({
          organisationId: session.organisationId,
          curriculumModuleId: proposal.moduleId,
          topicId: topic,
          code: proposal.code,
          description: proposal.description,
          addedFrom: proposal.addedFrom,
          sortOrder: 1000,
        })
        .onConflictDoNothing()
        .returning({ id: assessmentCriteria.id });
      added += inserted.length;
    }

    if (added > 0) {
      curriculum = await loadCurriculum(tx, qualificationId);
      matched = match(reading, curriculum);
    }

    // Replace what was recorded for this qualification's lines.
    const elementIds = curriculum.elements.map((e) => e.id);
    const criterionIds = curriculum.criteria.map((c) => c.id);
    if (elementIds.length) {
      await tx.delete(topicElementAlignment).where(inArray(topicElementAlignment.topicElementId, elementIds));
    }
    if (criterionIds.length) {
      await tx.delete(criterionAlignment).where(inArray(criterionAlignment.criterionId, criterionIds));
    }

    let recorded = 0;
    if (matched.elementAlignments.length) {
      const inserted = await tx
        .insert(topicElementAlignment)
        .values(matched.elementAlignments.map((row) => ({ organisationId: session.organisationId, ...row })))
        .onConflictDoNothing()
        .returning({ id: topicElementAlignment.id });
      recorded += inserted.length;
    }
    if (matched.criterionAlignments.length) {
      const inserted = await tx
        .insert(criterionAlignment)
        .values(matched.criterionAlignments.map((row) => ({ organisationId: session.organisationId, ...row })))
        .onConflictDoNothing()
        .returning({ id: criterionAlignment.id });
      recorded += inserted.length;
    }

    const proposedAdditions = [...matched.proposals.values()].map((p) => ({
      key: p.key,
      kind: p.kind,
      moduleCode: p.moduleCode,
      topicCode: p.topicCode,
      code: p.code,
      description: p.description,
      reason: p.reason,
    }));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: added > 0 ? "alignment_matrix.additions_confirmed" : "alignment_matrix.imported",
      entityType: "qualification",
      entityId: qualificationId,
      after: {
        sheets: reading.sheets.map((s) => s.sheetName),
        rows: matched.rowsRead,
        elementsMatched: matched.elementsMatched.size,
        criteriaMatched: matched.criteriaMatched.size,
        recorded,
        added,
        stillProposed: proposedAdditions.length,
        unmatched: [...matched.unmatched].slice(0, 50),
      },
    });

    return {
      sheetName: reading.sheetName,
      sheetsRead: reading.sheets.map((s) => s.sheetName),
      columnsRecognised: [...new Set(reading.sheets.flatMap((s) => s.columns.map((c) => c.header)))],
      rowsRead: matched.rowsRead,
      elementsMatched: matched.elementsMatched.size,
      criteriaMatched: matched.criteriaMatched.size,
      alignmentsRecorded: recorded,
      unmatchedCodes: [...matched.unmatched].sort(),
      proposedAdditions,
      added,
    };
  });
}
