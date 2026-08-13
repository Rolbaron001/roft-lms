/**
 * Reading Word and Excel files.
 *
 * These are the failures that matter for a spreadsheet reader, and both are
 * silent: a column that shifts, and a multi-line cell that collapses into one
 * value. Neither throws, both produce a plausible-looking result, and the
 * alignment matrix they feed is the document an accreditation visit asks for
 * first.
 */
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readXlsxSheets, readDocxText, OfficeReadError } from "@/lib/office";
import {
  readAlignmentMatrix,
  AlignmentMatrixError,
} from "@/lib/alignment-matrix";

/** A workbook with one sheet, built from raw cell XML. */
function workbook(cellXml: string, strings: string[] = []): Uint8Array {
  const sharedXml = `<?xml version="1.0"?><sst count="${strings.length}" uniqueCount="${strings.length}">${strings
    .map((value) => `<si><t>${value}</t></si>`)
    .join("")}</sst>`;

  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook><sheets><sheet name="Matrix" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/sharedStrings.xml": strToU8(sharedXml),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${cellXml}</sheetData></worksheet>`,
    ),
  });
}

function docx(bodyXml: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`,
    ),
  });
}

describe("reading a workbook", () => {
  it("keeps an empty cell from swallowing the one after it", () => {
    // Excel writes empty cells self-closing. The closing "/" is not a ">", so
    // a naive <c …>…</c> pattern runs past it and takes the next cell's value
    // while keeping the empty cell's column — shifting the whole row left.
    const sheets = readXlsxSheets(
      workbook(
        `<row r="1">` +
          `<c r="A1" t="s"><v>0</v></c>` +
          `<c r="B1"/>` +
          `<c r="C1" t="s"><v>1</v></c>` +
          `</row>`,
        ["first", "third"],
      ),
    );

    expect(sheets[0].rows[0]).toEqual(["first", "", "third"]);
  });

  it("places cells by their column letter, not by their order", () => {
    const sheets = readXlsxSheets(
      workbook(`<row r="1"><c r="D1" t="s"><v>0</v></c></row>`, ["late"]),
    );

    expect(sheets[0].rows[0]).toEqual(["", "", "", "late"]);
  });

  it("keeps the line breaks inside a cell", () => {
    // Excel uses them to hold several values in one cell. Collapsing them to
    // spaces turns a list of four criteria into one unreadable string.
    const sheets = readXlsxSheets(
      workbook(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`, [
        "SA2\nSA3",
      ]),
    );

    expect(sheets[0].rows[0][0]).toBe("SA2\nSA3");
  });

  it("refuses a file that is not an Office document at all", () => {
    expect(() => readXlsxSheets(new Uint8Array([1, 2, 3, 4]))).toThrow(
      OfficeReadError,
    );
  });
});

describe("reading a Word document", () => {
  it("puts each paragraph on its own line", () => {
    const text = readDocxText(
      docx(
        `<w:p><w:r><w:t>First line</w:t></w:r></w:p>` +
          `<w:p><w:r><w:t>Second line</w:t></w:r></w:p>`,
      ),
    );

    expect(text).toBe("First line\nSecond line");
  });

  it("keeps table cells apart", () => {
    const text = readDocxText(
      docx(
        `<w:tbl><w:tr>` +
          `<w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>` +
          `<w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc>` +
          `</w:tr></w:tbl>`,
      ),
    );

    expect(text).toContain("Name");
    expect(text).toContain("Value");
    expect(text.replace(/\s+/g, " ")).not.toBe("NameValue");
  });
});

describe("reading an alignment matrix", () => {
  const header =
    `<row r="1">` +
    `<c r="A1" t="s"><v>0</v></c>` + // Topic Elements - WHAT
    `<c r="B1" t="s"><v>1</v></c>` + // Internal Assessment Criteria - HOW
    `<c r="C1" t="s"><v>2</v></c>` + // WorkBook
    `<c r="D1" t="s"><v>3</v></c>` + // Summative Assignment
    `<c r="E1" t="s"><v>4</v></c>` + // Legislation
    `</row>`;

  const strings = [
    "Topic Elements - WHAT",
    "Internal Assessment Criteria - HOW",
    "WorkBook",
    "Summative Assignment",
    "Legislation",
    "KT0101 Something to teach.\nKT0102 Something else.",
    "IAC0101 Something to achieve.",
    "WB1",
    "SA1",
    "BCEA",
  ];

  const dataRow =
    `<row r="2">` +
    `<c r="A2" t="s"><v>5</v></c>` +
    `<c r="B2" t="s"><v>6</v></c>` +
    `<c r="C2" t="s"><v>7</v></c>` +
    `<c r="D2" t="s"><v>8</v></c>` +
    `<c r="E2" t="s"><v>9</v></c>` +
    `</row>`;

  it("finds every resource column and both element codes", () => {
    const reading = readAlignmentMatrix(workbook(header + dataRow, strings));

    expect(reading.columns.map((c) => c.kind)).toEqual([
      "workbook",
      "summative_assessment",
      "legislation",
    ]);
    expect(reading.rows).toHaveLength(1);
    expect(reading.rows[0].elementCodes).toEqual(["KT0101", "KT0102"]);
    expect(reading.rows[0].resources).toEqual([
      { kind: "workbook", reference: "WB1" },
      { kind: "summative_assessment", reference: "SA1" },
      { kind: "legislation", reference: "BCEA" },
    ]);
  });

  it("does not mistake the assessment criteria column for a resource", () => {
    // "Internal Assessment Criteria" contains the word "assessment". Filing it
    // as the summative assessment that covers the row would turn every
    // criterion into a resource reference and bury the real ones.
    const reading = readAlignmentMatrix(workbook(header + dataRow, strings));

    expect(
      reading.columns.some((column) => /criteria/i.test(column.header)),
    ).toBe(false);
    expect(
      reading.rows[0].resources.some((r) => r.reference.startsWith("IAC")),
    ).toBe(false);
  });

  it("refuses a workbook with no column of curriculum lines", () => {
    expect(() =>
      readAlignmentMatrix(
        workbook(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`, ["Notes"]),
      ),
    ).toThrow(AlignmentMatrixError);
  });
});
