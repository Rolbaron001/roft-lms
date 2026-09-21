import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
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
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OfficeReadError";
  }
}

/**
 * A zip bomb is a small archive that expands to fill a disk. Office files of
 * the kind this platform handles — an 85-page curriculum, a marking memo — do
 * not approach this, so a limit costs nothing and removes the failure mode.
 */
const MAX_ENTRY_BYTES = 80 * 1024 * 1024;

/**
 * The signature of the pre-2007 Office formats.
 *
 * A .doc or .xls from that era is an OLE compound file, not a zip, so the
 * reader below cannot open one — and said so by suggesting the file was
 * "damaged or is not really the type it claims to be", which is untrue and
 * unhelpful to somebody holding a perfectly good document that is simply
 * twenty years old. The upload control offers .doc, so this is a file the
 * platform invites and then insults.
 */
const LEGACY_OFFICE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function looksLegacy(bytes: Uint8Array): boolean {
  return LEGACY_OFFICE.every((byte, index) => bytes[index] === byte);
}

function open(bytes: Uint8Array): Record<string, Uint8Array> {
  if (looksLegacy(bytes)) {
    throw new OfficeReadError(
      "That is an older Word or Excel file - the format used before 2007, which is a different thing inside despite the similar name. Nothing is wrong with it. Open it and use Save As to make a .docx or .xlsx, and that will read.",
    );
  }

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
 * Removes text somebody struck through.
 *
 * Roland, 21 September 2026, after two rounds of me reading a document back to
 * him with his own deletions still in it: "I think the problem is that you are
 * not reading strikethrough text correctly."
 *
 * He was right, and it matters far beyond a job sheet. This reader is what the
 * platform uses on every Word document a provider uploads: the curriculum it
 * transcribes modules and assessment criteria from, the alignment document it
 * builds study units from, the workbooks and memoranda Capture turns into
 * questions a learner answers.
 *
 * Strikethrough is how people delete things in a document under review. A
 * curriculum with a withdrawn criterion struck through, a workbook with a
 * question struck out before a cohort sits it, an answer guide with a
 * superseded answer struck and the correct one beside it: every one of those
 * was read as live text. The struck line would have been transcribed as a
 * criterion learners must meet, or captured as a question with the wrong
 * answer marked correct, and nothing on any screen would have looked wrong.
 *
 * Both forms count, single and double. A run carrying w:val="0" or "false" is
 * switching it off, usually to escape a style that had it on, so that is not a
 * deletion.
 *
 * Anything this cannot parse is left alone, which is the safe direction:
 * showing text somebody deleted is a fault, and dropping text they kept would
 * be a worse one.
 */
function withoutStruckRuns(xml: string): string {
  if (!/<w:(?:d)?strike\b/.test(xml)) return xml;

  return xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
    const properties = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1];
    if (!properties) return run;

    const struck = /<w:(?:d)?strike(?:\s[^>]*)?\/?>/.exec(properties);
    if (!struck) return run;
    if (/w:val="(?:0|false|off)"/.test(struck[0])) return run;

    /*
     * Emptied rather than removed, so the paragraph and table structure the
     * reader below depends on stays exactly as it was. Dropping the element
     * would merge a struck cell into its neighbour.
     */
    return "<w:r></w:r>";
  });
}

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
  const xml = withoutStruckRuns(xmlOf(entries, "word/document.xml"));

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
  // Loading the reader is a separate failure from failing to read a document,
  // and it was previously outside the guard below — so when the module threw
  // on import the error escaped as a bare ReferenceError, was caught by a
  // generic handler several layers up, and reached the user as the name of
  // their file and nothing else. Whatever goes wrong here is the platform's
  // fault, not the document's, and it says so.
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    throw new OfficeReadError(
      "The PDF reader could not be loaded, so no PDF can be read on this server. " +
        "This is a fault in the installation, not in the document: " +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }

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
    // The cause is carried through rather than flattened. "This PDF could not
    // be read" is the same message for a corrupt file and for a runtime that
    // failed to load the reader at all, and those need very different fixes.
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new OfficeReadError(`This PDF could not be read${detail}`);
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

  const text = normaliseSymbolBullets(
    parts.join("\n\n").replace(/\u0000/g, ""),
  ).trim();

  return {
    text,
    pages,
    // Roughly a short paragraph a page. A text PDF clears this by an order of
    // magnitude; a scan produces almost nothing at all.
    looksScanned: text.length < pages * 200,
  };
}

/**
 * Word's bulleted lists, as they come out of a PDF.
 *
 * A bullet typed in Word is not the character U+2022. It is a glyph from the
 * Symbol or Wingdings font, and those fonts map their glyphs into the Unicode
 * Private Use Area - so the bullet arrives as U+F0B7 and the hollow square as
 * U+F0A7. Nothing renders them, nothing matches them, and critically they are
 * not whitespace, so trimming a line does not remove one.
 *
 * That is worth naming. The Commercial Cleaner curriculum (SAQA 118709) puts
 * one in front of every topic element and every internal assessment criterion
 * - 1,164 of them - and the reader, anchoring its patterns at the start of a
 * line, matched not one. Twenty-two modules and ninety-two topics imported;
 * zero criteria did. The document looked like it had worked, right up until
 * somebody opened a module and found nothing to assess against.
 *
 * Only glyphs that are certainly bullets are translated, and they are
 * translated rather than deleted: the document did say "this is a list item",
 * and a reader downstream may want to know. Any other private-use character is
 * left exactly as it is. Deleting those would be guessing at content, and the
 * failure above is the argument against guessing quietly - it was caught
 * because the reader said what it could not read, not because it stayed
 * silent.
 */
const SYMBOL_BULLETS: Record<string, string> = {
  "\uF0B7": "\u2022", // Symbol, filled round bullet
  "\uF0A7": "\u25AA", // Wingdings, filled square
  "\uF06C": "\u2022", // Wingdings, filled round bullet
  "\uF06E": "\u25AA", // Wingdings, filled square
  "\uF0D8": "\u27A2", // Wingdings, arrowhead
  "\uF0FC": "\u2713", // Wingdings, tick
};

const SYMBOL_BULLET_PATTERN = /[\uF0B7\uF0A7\uF06C\uF06E\uF0D8\uF0FC]/g;

function normaliseSymbolBullets(text: string): string {
  return text.replace(
    SYMBOL_BULLET_PATTERN,
    (glyph) => SYMBOL_BULLETS[glyph] ?? glyph,
  );
}

/**
 * Where pdf.js keeps the metrics for the fourteen fonts a PDF is allowed to
 * assume rather than embed. Without them those fonts extract poorly.
 *
 * Resolved rather than hardcoded so it survives the standalone build, and
 * tolerated when missing: no font data degrades a minority of documents, while
 * throwing here would fail every upload.
 */
/**
 * pdf.js treats this as a URL, not a path: it checks for a trailing "/" and
 * refuses anything else with "must include trailing slash". On Windows a
 * native path ends in a backslash and is rejected, so separators are
 * normalised and the slash is guaranteed.
 */
function asFactoryUrl(directory: string): string {
  const normalised = directory.split(String.fromCharCode(92)).join("/");
  return normalised.endsWith("/") ? normalised : `${normalised}/`;
}

function standardFontsPath(): string | undefined {
  const candidates: string[] = [];

  // Under a bundler, require.resolve hands back a virtual path such as
  // "[externals]/pdfjs-dist/package.json [external] (…)" rather than a real
  // one. Handed to pdf.js that produces "Invalid factory url", and *every*
  // PDF becomes unreadable — so a candidate is only used if it looks like an
  // absolute filesystem path and actually exists.
  try {
    const resolved = require.resolve("pdfjs-dist/package.json");
    if (!resolved.includes("[") && isAbsolute(resolved)) {
      candidates.push(resolved.replace(/package\.json$/, "standard_fonts"));
    }
  } catch {
    // Nothing to add; the cwd candidate below still applies.
  }

  candidates.push(
    join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts"),
  );

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return asFactoryUrl(candidate);
    } catch {
      // Unreadable path, try the next.
    }
  }

  // None found. The standard fourteen fonts extract less well without their
  // metrics, which degrades a minority of documents — where a bad path would
  // break all of them.
  return undefined;
}
