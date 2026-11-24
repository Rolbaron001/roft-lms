/**
 * The default programme matrix (job sheet D60 stage 3, 24 November 2026).
 *
 * A spreadsheet in the platform's own format, saying how a folder's files link
 * up: which study unit each is in, what it is, which guide each paper has, and
 * which files are left out. Offered, never required. It is downloaded already
 * filled in from the map, so nobody starts from an empty grid; put back in the
 * folder as "Programme map.xlsx", it is read before anything else on the next
 * upload, and every row is checked against the folder.
 *
 * The provider's own alignment document stays as it is and is read as before.
 * This says only how the files link, which an alignment document was never
 * designed to say precisely.
 */
import type { IngestionPlan, PlannedDocument } from "./folder-plan";
import { readXlsxSheets } from "./office";
import { writeXlsx } from "./xlsx-write";

/** The first cell of the "About" sheet: how the platform knows the matrix is its own. */
export const MATRIX_MARKER = "ROFT programme map";

/** What a file is, in the spreadsheet's words, and the platform's kind for each. */
export const MATRIX_KINDS: { label: string; kind: string }[] = [
  { label: "Theory guide or slides", kind: "theory_guide" },
  { label: "Learner handbook", kind: "learner_handbook" },
  { label: "Workbook", kind: "workbook" },
  { label: "Workbook guide", kind: "workbook_memorandum" },
  { label: "Summative", kind: "summative_assessment" },
  { label: "Summative guide", kind: "summative_memorandum" },
  { label: "Curriculum", kind: "curriculum_document" },
  { label: "Qualification document", kind: "qualification_document" },
  { label: "Alignment document", kind: "alignment_matrix" },
  { label: "Roll-out schedule", kind: "rollout_schedule" },
  { label: "Programme guide", kind: "learning_programme_guide" },
  { label: "Other", kind: "other" },
];
const labelOf = (kind: string | null) => MATRIX_KINDS.find((one) => one.kind === kind)?.label ?? "Other";
const kindOf = (label: string) => MATRIX_KINDS.find((one) => one.label.toLowerCase() === label.trim().toLowerCase())?.kind ?? null;

const FILES_HEADER = ["File name", "What it is", "Study unit", "Also covers", "Its guide (file name)", "Leave out"];

/** The matrix of a plan, as a spreadsheet. */
export async function writeMatrix(plan: IngestionPlan, about: { title: string; code: string | null }): Promise<Uint8Array> {
  const byPath = new Map(plan.documents.map((document) => [document.path, document]));
  const files = plan.documents
    // Not the library's documents, nor a programme map already in the folder.
    .filter((document) => document.target !== "library" && !(/\.xlsx$/i.test(document.filename) && /programme\s*map/i.test(document.filename)))
    .map((document) => [
      document.filename,
      labelOf(document.kind),
      document.studyUnitCode ?? "",
      (document.also ?? []).join("; "),
      document.guidePath ? (byPath.get(document.guidePath)?.filename ?? "") : "",
      document.ignored ? "Yes" : "No",
    ]);
  return writeXlsx([
    {
      name: "Files",
      rows: [FILES_HEADER, ...files],
      widths: [60, 24, 12, 16, 60, 10],
      lists: [
        { column: 1, values: MATRIX_KINDS.map((one) => one.label) },
        { column: 5, values: ["No", "Yes"] },
      ],
    },
    {
      name: "Study units",
      rows: [["Code", "Title"], ...plan.studyUnits.map((unit) => [unit.code, unit.title])],
      widths: [10, 80],
    },
    {
      name: "About",
      rows: [
        [MATRIX_MARKER, "1"],
        ["Programme", about.title],
        ["Curriculum code", about.code ?? ""],
        ["Prepared", new Date().toISOString().slice(0, 10)],
        ["How to use it", "Change what is wrong, save it in the programme's folder as Programme map.xlsx, and upload the folder. It is read before anything else."],
      ],
      widths: [20, 100],
    },
  ]);
}

export type MatrixRow = { filename: string; kind: string | null; unit: string | null; also: string[]; guide: string | null; leaveOut: boolean };

/** A filled-in matrix, or null when the spreadsheet is not one. */
export function readMatrix(bytes: Uint8Array): MatrixRow[] | null {
  let sheets;
  try {
    sheets = readXlsxSheets(bytes);
  } catch {
    return null;
  }
  const about = sheets.find((sheet) => sheet.name.toLowerCase() === "about");
  if (about?.rows[0]?.[0]?.trim() !== MATRIX_MARKER) return null;
  const files = sheets.find((sheet) => sheet.name.toLowerCase() === "files");
  if (!files) return [];
  const unitCode = (value: string) => {
    const match = /^\s*(?:SU\s?|study\s+unit\s+|unit\s+)?0?(\d{1,2})\s*$/i.exec(value);
    return match ? `SU${Number(match[1])}` : null;
  };
  return files.rows
    .slice(1)
    .filter((row) => (row[0] ?? "").trim())
    .map((row) => ({
      filename: row[0].trim(),
      kind: row[1] ? kindOf(row[1]) : null,
      unit: row[2] ? unitCode(row[2]) : null,
      also: (row[3] ?? "")
        .split(/[;,]/)
        .map((one) => unitCode(one))
        .filter((one): one is string => Boolean(one)),
      guide: (row[4] ?? "").trim() || null,
      leaveOut: /^\s*(yes|y|true|1)\s*$/i.test(row[5] ?? ""),
    }));
}

/** Folder files are matched by name, ignoring case and spaces against underscores. */
const sameName = (a: string, b: string) => a.toLowerCase().replace(/[\s_]+/g, " ").trim() === b.toLowerCase().replace(/[\s_]+/g, " ").trim();

/**
 * The matrix applied over what the readers found. Every row it names is
 * taken as confirmed; files it does not name stay as read, for the map.
 * Returns what does not match, in plain words.
 */
export function applyMatrix(plan: IngestionPlan, rows: MatrixRow[], matrixPath: string, knownUnits: string[] = []): string[] {
  const notes: string[] = [];
  const units = new Set([...plan.studyUnits.map((unit) => unit.code), ...knownUnits]);
  const find = (filename: string) => plan.documents.find((document) => document.path !== matrixPath && sameName(document.filename, filename));
  const itself = matrixPath.split("/").pop() ?? "";
  for (const row of rows) {
    // Its own row, where the download listed it.
    if (sameName(row.filename, itself)) continue;
    const document = find(row.filename);
    if (!document) {
      notes.push(`The programme map lists "${row.filename}", which is not in the folder.`);
      continue;
    }
    applyRow(units, document, row, find, notes);
  }
  const named = new Set(rows.map((row) => find(row.filename)).filter(Boolean));
  const unnamed = plan.documents.filter((document) => document.path !== matrixPath && document.target !== "library" && !named.has(document));
  if (unnamed.length > 0) {
    notes.push(`${unnamed.length} ${unnamed.length === 1 ? "file is" : "files are"} not in the programme map, so ${unnamed.length === 1 ? "it was" : "they were"} placed as read: check ${unnamed.length === 1 ? "it" : "them"} on the map.`);
  }
  return notes;
}

function applyRow(
  units: Set<string>,
  document: PlannedDocument,
  row: MatrixRow,
  find: (filename: string) => PlannedDocument | undefined,
  notes: string[],
): void {
  if (row.leaveOut) {
    document.ignored = true;
    document.confirmed = true;
    return;
  }
  if (row.kind) document.kind = row.kind;
  if (row.unit) {
    if (!units.has(row.unit)) {
      notes.push(`The programme map puts "${row.filename}" in ${row.unit}, which this programme does not have.`);
    } else {
      document.studyUnitCode = row.unit;
      document.target = "study_unit";
    }
  }
  document.also = row.also.filter((code) => code !== document.studyUnitCode);
  if (row.guide) {
    const guide = find(row.guide);
    if (guide) {
      document.guidePath = guide.path;
      document.guideSource = "person";
      document.noGuide = false;
    } else {
      notes.push(`The programme map gives "${row.filename}" the guide "${row.guide}", which is not in the folder.`);
    }
  }
  document.source = "person";
  document.because = `${document.because} Placed by the programme map.`.trim();
  document.confirmed = true;
}
