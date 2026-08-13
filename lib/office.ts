import { unzipSync } from "fflate";

/**
 * Reading Word and Excel files.
 *
 * Both are ZIP archives of XML, so this is unzip plus enough XML handling to
 * pull out text and cells. Deliberately not a full Office implementation: the
 * platform needs to read what a provider wrote, not reproduce Word.
 *
 * Everything here runs on files a user uploaded, so it is written to fail
 * rather than to cope. A malformed archive throws; it does not guess.
 */

export class OfficeReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficeReadError";
  }
}

/**
 * A zip bomb is a small archive that expands to fill a disk. Office files of
 * the kind this platform handles — an 85-page curriculum, a marking memo — do
 * not approach this, so a limit costs nothing and removes the failure mode.
 */
const MAX_ENTRY_BYTES = 80 * 1024 * 1024;

function open(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, {
      filter: (file) => file.originalSize <= MAX_ENTRY_BYTES,
    });
  } catch {
    throw new OfficeReadError(
      "This file could not be opened. Word and Excel files are archives inside, and this one is damaged or is not really the type it claims to be.",
    );
  }
}

const decoder = new TextDecoder("utf-8");

function xmlOf(entries: Record<string, Uint8Array>, path: string): string {
  const entry = entries[path];
  if (!entry) {
    throw new OfficeReadError(
      `This file is missing ${path}, so it is not a readable Office document.`,
    );
  }
  return decoder.decode(entry);
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Strips tags, keeping the text between them. */
function textFrom(xml: string): string {
  return unescapeXml(xml.replace(/<[^>]*>/g, ""));
}

// ----------------------------------------------------------------------- docx

/**
 * The visible text of a Word document, one line per paragraph and table cells
 * separated by tabs.
 *
 * Layout is deliberately preserved this crudely. It is enough to search the
 * text and enough to read a table row by row, and anything more faithful means
 * implementing Word's layout model.
 */
export function readDocxText(bytes: Uint8Array): string {
  const entries = open(bytes);
  const xml = xmlOf(entries, "word/document.xml");

  return xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => unescapeXml(line).replace(/\t+$/, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ----------------------------------------------------------------------- xlsx

export type Sheet = {
  name: string;
  /** Rows of cells, already resolved to text. Ragged: trailing blanks dropped. */
  rows: string[][];
};

/** Excel column letters to a zero-based index: A→0, Z→25, AA→26. */
function columnIndex(reference: string): number {
  const letters = reference.replace(/[0-9]/g, "");
  let index = 0;
  for (const character of letters) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function sharedStrings(entries: Record<string, Uint8Array>): string[] {
  if (!entries["xl/sharedStrings.xml"]) return [];
  const xml = decoder.decode(entries["xl/sharedStrings.xml"]);
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    // A cell's text can be split across several runs by formatting, so the
    // tags are stripped rather than the first run taken.
    //
    // Line breaks inside a cell are kept. Excel uses them to list several
    // values in one cell — four criteria, three workbooks — and collapsing
    // them to spaces turns a list into one long string that every downstream
    // reader then treats as a single value.
    textFrom(match[1])
      .replace(/[^\S\n]+/g, " ")
      .trim(),
  );
}

/**
 * Every sheet of a workbook, as text.
 *
 * Formulae are not evaluated — the cached value Excel stored is used, which is
 * what the author last saw. A sheet of formulae never opened in Excel would
 * read as empty, and that is the honest answer.
 */
export function readXlsxSheets(bytes: Uint8Array): Sheet[] {
  const entries = open(bytes);
  const strings = sharedStrings(entries);
  const workbook = xmlOf(entries, "xl/workbook.xml");

  const names = [...workbook.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map(
    (match) => unescapeXml(match[1]),
  );

  const sheets: Sheet[] = [];

  for (const [index, name] of names.entries()) {
    const path = `xl/worksheets/sheet${index + 1}.xml`;
    if (!entries[path]) continue;

    const xml = decoder.decode(entries[path]);
    const rows: string[][] = [];

    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];

      // Empty cells are written self-closing: <c r="H9" s="12"/>. Matching
      // only <c …>…</c> lets one of those swallow the cell after it — the
      // closing "/" is not a ">", so the pattern runs on and takes the next
      // cell's value while keeping the empty cell's reference. Everything then
      // shifts one column left, silently, which is the worst way for a
      // spreadsheet reader to be wrong.
      for (const cellMatch of rowMatch[1].matchAll(
        /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const attributes = cellMatch[1];
        const inner = cellMatch[2] ?? "";

        const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1];
        const at = reference ? columnIndex(reference) : cells.length;

        // Inline strings sit in <is>; everything else in <v>.
        const type = /t="([^"]*)"/.exec(attributes)?.[1];
        let value: string;

        if (type === "inlineStr") {
          value = textFrom(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
        } else {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
          value =
            type === "s" && /^\d+$/.test(raw)
              ? (strings[Number(raw)] ?? "")
              : unescapeXml(raw);
        }

        while (cells.length < at) cells.push("");
        cells[at] = value.trim();
      }

      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      rows.push(cells);
    }

    sheets.push({ name, rows });
  }

  if (sheets.length === 0) {
    throw new OfficeReadError("This workbook has no readable sheets.");
  }

  return sheets;
}
