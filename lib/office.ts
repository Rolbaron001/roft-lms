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

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/**
 * A curriculum document runs to 85 pages. This is far above anything real and
 * exists only so that a deliberately enormous file cannot occupy a worker
 * indefinitely.
 */
const MAX_PDF_PAGES = 1500;

export type PdfText = {
  text: string;
  pages: number;
  /**
   * True when the file parsed but held almost no text — the signature of a
   * scan. Worth surfacing rather than hiding: a scanned curriculum uploads
   * cleanly and then silently helps with nothing, and the person who uploaded
   * it is the only one who can go and find a digital copy.
   */
  looksScanned: boolean;
};

/**
 * Pulls the text out of a PDF.
 *
 * Unlike the Word and Excel readers above, this leans on Mozilla's pdf.js
 * rather than being written here. A .docx is a zip of XML and yields to a
 * hundred lines; a PDF is a graphics format that happens to carry text, and
 * recovering characters means resolving cross-reference streams, object
 * streams and per-font encoding tables. Written by hand it would work on most
 * documents and quietly produce mojibake on the rest — and this text is what
 * somebody transcribes a curriculum from, so quietly-wrong is the one outcome
 * worth paying to avoid.
 *
 * The import is dynamic because pdf.js is large and most uploads are not PDFs.
 */
export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let document;
  try {
    document = await pdfjs.getDocument({
      // pdf.js takes ownership of the buffer, so it is handed a copy: the
      // caller still needs these bytes to hash and store the file.
      data: new Uint8Array(bytes),
      standardFontDataUrl: standardFontsPath(),
      // This runs on a file a stranger uploaded, so it is kept to reading what
      // is in the file: no substituting fonts off this machine, and no
      // fetching anything the document points at. Extracting text never runs
      // the JavaScript a PDF may carry — only a viewer does that.
      useSystemFonts: false,
      useWorkerFetch: false,
    }).promise;
  } catch (error) {
    const reason =
      error && typeof error === "object" && "name" in error
        ? String((error as { name: unknown }).name)
        : "";

    if (reason === "PasswordException") {
      throw new OfficeReadError(
        "This PDF is password protected, so its text cannot be read. Upload an unprotected copy.",
      );
    }
    throw new OfficeReadError("This PDF could not be read.");
  }

  const pages = document.numPages;
  if (pages > MAX_PDF_PAGES) {
    throw new OfficeReadError(
      `This PDF has ${pages} pages, which is beyond what the platform reads.`,
    );
  }

  const parts: string[] = [];

  try {
    for (let number = 1; number <= pages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();

      // hasEOL is pdf.js telling us the item ended a line in the original
      // layout. Honouring it keeps a table row on one line and a heading off
      // the end of the paragraph above it, which is the difference between
      // text somebody can read down and one continuous smear.
      parts.push(
        content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
          )
          .join(""),
      );

      // Released as we go. Holding 85 pages of glyph data at once is the
      // difference between a modest process and one the container kills.
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  const text = parts.join("\n\n").replace(/\u0000/g, "").trim();

  return {
    text,
    pages,
    // Roughly a short paragraph a page. A text PDF clears this by an order of
    // magnitude; a scan produces almost nothing at all.
    looksScanned: text.length < pages * 200,
  };
}

/**
 * Where pdf.js keeps the metrics for the fourteen fonts a PDF is allowed to
 * assume rather than embed. Without them those fonts extract poorly.
 *
 * Resolved rather than hardcoded so it survives the standalone build, and
 * tolerated when missing: no font data degrades a minority of documents, while
 * throwing here would fail every upload.
 */
function standardFontsPath(): string | undefined {
  try {
    return require
      .resolve("pdfjs-dist/package.json")
      .replace(/package\.json$/, "standard_fonts/");
  } catch {
    return undefined;
  }
}
