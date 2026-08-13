import { eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  topicElementAlignment,
} from "@/db/schema";
import { readXlsxSheets, type Sheet } from "./office";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Reading a provider's Curriculum Alignment Matrix.
 *
 * This is the document an accreditation visit asks for first: one row per
 * curriculum topic, and against it the workbook that teaches it, the
 * assessment that tests it, the handbook chapter it lives in, and the
 * standards, policies and legislation it draws on. Providers maintain it in
 * Excel and will carry on doing so — it is a planning surface, and a
 * spreadsheet is a good one.
 *
 * What the platform gets from reading it is the ability to answer "what covers
 * KM0201" without anyone opening the file, and to notice when the matrix
 * refers to a curriculum line that does not exist.
 *
 * The columns are read from the header row rather than by position, because
 * every provider's matrix has a different set. Curiosa's has fourteen; the
 * next one will not.
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
 */
const HEADER_PATTERNS: { pattern: RegExp; kind: ResourceKind }[] = [
  { pattern: /work\s*book/i, kind: "workbook" },
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

/** The column holding the curriculum lines this row is about. */
const ELEMENT_HEADER = /topic\s*element|practical\s*application|work\s*activit/i;

/**
 * Columns that describe the curriculum rather than pointing at a resource.
 *
 * Checked before the patterns below, because "Internal Assessment Criteria"
 * contains the word "assessment" and would otherwise be filed as the summative
 * assessment that covers the row — turning every criterion into a resource
 * reference and burying the real ones.
 */
const NOT_A_RESOURCE =
  /assessment\s*criteria|^\s*elo\s*$|^\s*module|^\s*topic|^\s*#|^\s*no\.?\s*$/i;

export type MatrixRow = {
  /** Codes found in the elements column: KT0101, PA0101, WA0101 … */
  elementCodes: string[];
  resources: { kind: ResourceKind; reference: string }[];
};

export type MatrixReading = {
  sheetName: string;
  headerRow: number;
  columns: { index: number; header: string; kind: ResourceKind }[];
  rows: MatrixRow[];
};

/** Any code of the form two letters then four digits, as the documents use. */
function codesIn(cell: string): string[] {
  return [...cell.matchAll(/\b([A-Z]{2}\d{4})\b/g)].map((match) => match[1]);
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

function findHeaderRow(sheet: Sheet): number {
  return sheet.rows.findIndex((row) =>
    row.some((cell) => ELEMENT_HEADER.test(cell)),
  );
}

/**
 * Reads the matrix without touching the database, so a file can be checked
 * before it is trusted.
 */
export function readAlignmentMatrix(bytes: Uint8Array): MatrixReading {
  const sheets = readXlsxSheets(bytes);

  const found = sheets
    .map((sheet) => ({ sheet, headerRow: findHeaderRow(sheet) }))
    .find((candidate) => candidate.headerRow !== -1);

  if (!found) {
    throw new AlignmentMatrixError(
      "No alignment matrix found in this workbook. One column must be headed something like “Topic Elements”, so the rows can be matched to the curriculum.",
    );
  }

  const { sheet, headerRow } = found;
  const header = sheet.rows[headerRow];

  const elementColumn = header.findIndex((cell) => ELEMENT_HEADER.test(cell));

  const columns = header
    .map((cell, index) => {
      if (index === elementColumn || !cell.trim()) return null;
      if (NOT_A_RESOURCE.test(cell)) return null;
      const match = HEADER_PATTERNS.find((entry) => entry.pattern.test(cell));
      return match ? { index, header: cell, kind: match.kind } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (columns.length === 0) {
    throw new AlignmentMatrixError(
      "The matrix has no resource columns that could be recognised — nothing headed Workbook, Assessment, Theory Guide, Legislation and so on.",
    );
  }

  const rows: MatrixRow[] = [];

  for (const row of sheet.rows.slice(headerRow + 1)) {
    const elementCodes = codesIn(row[elementColumn] ?? "");
    if (elementCodes.length === 0) continue;

    const resources = columns.flatMap((column) =>
      referencesIn(row[column.index] ?? "").map((reference) => ({
        kind: column.kind,
        reference,
      })),
    );

    if (resources.length > 0) {
      rows.push({ elementCodes, resources });
    }
  }

  return { sheetName: sheet.name, headerRow: headerRow + 1, columns, rows };
}

export type MatrixImportSummary = {
  sheetName: string;
  columnsRecognised: string[];
  rowsRead: number;
  elementsMatched: number;
  alignmentsRecorded: number;
  /**
   * Codes the matrix refers to that the curriculum does not contain. Usually
   * a module nobody has transcribed yet, occasionally a typo — either way the
   * matrix claims coverage of something the platform cannot see.
   */
  unmatchedCodes: string[];
};

/**
 * Records what the matrix says against the curriculum already imported.
 *
 * Matching is by element code within the qualification. Codes repeat across
 * modules — every module has a KT0101 — so a code is matched within the module
 * whose topics contain it, and a code appearing in several modules is recorded
 * against all of them. That is deliberate: the alternative is dropping the
 * row, which loses information the provider did record.
 */
export async function importAlignmentMatrix(
  session: AuthenticatedSession,
  qualificationId: string,
  bytes: Uint8Array,
): Promise<MatrixImportSummary> {
  assertSessionCan(session, "qualification:manage");
  const reading = readAlignmentMatrix(bytes);

  return withTenant(session.organisationId, async (tx) => {
    const modules = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));

    if (modules.length === 0) {
      throw new AlignmentMatrixError(
        "Import the curriculum document before the alignment matrix — there is nothing yet for its rows to attach to.",
      );
    }

    const topics = await tx
      .select({ id: curriculumTopics.id })
      .from(curriculumTopics)
      .where(
        inArray(
          curriculumTopics.curriculumModuleId,
          modules.map((m) => m.id),
        ),
      );

    const elements = topics.length
      ? await tx
          .select({
            id: curriculumTopicElements.id,
            code: curriculumTopicElements.code,
          })
          .from(curriculumTopicElements)
          .where(
            inArray(
              curriculumTopicElements.topicId,
              topics.map((t) => t.id),
            ),
          )
      : [];

    const idsByCode = new Map<string, string[]>();
    for (const element of elements) {
      idsByCode.set(element.code, [
        ...(idsByCode.get(element.code) ?? []),
        element.id,
      ]);
    }

    const unmatched = new Set<string>();
    const matched = new Set<string>();
    const values: {
      organisationId: string;
      topicElementId: string;
      kind: ResourceKind;
      reference: string;
    }[] = [];

    for (const row of reading.rows) {
      for (const code of row.elementCodes) {
        const ids = idsByCode.get(code);
        if (!ids) {
          unmatched.add(code);
          continue;
        }
        matched.add(code);
        for (const topicElementId of ids) {
          for (const resource of row.resources) {
            values.push({
              organisationId: session.organisationId,
              topicElementId,
              kind: resource.kind,
              reference: resource.reference,
            });
          }
        }
      }
    }

    // Replaced rather than added to. A matrix is a statement of what covers the
    // curriculum now; merging an old reading with a new one would leave a
    // withdrawn workbook listed forever.
    if (elements.length > 0) {
      await tx.delete(topicElementAlignment).where(
        inArray(
          topicElementAlignment.topicElementId,
          elements.map((e) => e.id),
        ),
      );
    }

    let recorded = 0;
    if (values.length > 0) {
      const inserted = await tx
        .insert(topicElementAlignment)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: topicElementAlignment.id });
      recorded = inserted.length;
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "alignment_matrix.imported",
      entityType: "qualification",
      entityId: qualificationId,
      after: {
        sheet: reading.sheetName,
        rows: reading.rows.length,
        matched: matched.size,
        recorded,
        unmatched: [...unmatched].slice(0, 50),
      },
    });

    return {
      sheetName: reading.sheetName,
      columnsRecognised: reading.columns.map((c) => c.header),
      rowsRead: reading.rows.length,
      elementsMatched: matched.size,
      alignmentsRecorded: recorded,
      unmatchedCodes: [...unmatched].sort(),
    };
  });
}
