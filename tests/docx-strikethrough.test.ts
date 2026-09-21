/**
 * Text somebody struck through is text somebody deleted.
 *
 * Roland, 21 September 2026, after two rounds of me reading his own job sheet
 * back to him with his deletions still in it: "I think the problem is that you
 * are not reading strikethrough text correctly."
 *
 * He was right, and the consequence is not a job sheet. This reader is what
 * the platform runs over every Word document a provider uploads: the
 * curriculum it transcribes assessment criteria from, the alignment document
 * it builds study units from, the workbooks and answer guides Capture turns
 * into questions a learner answers on screen.
 *
 * A criterion struck out because it was withdrawn would have been transcribed
 * as one learners must meet. A question struck out before a cohort sat the
 * paper would have been captured and asked. A superseded answer struck through
 * beside its replacement would have been read as the correct one. None of
 * those would look wrong on any screen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { readDocxText } from "@/lib/office";

/** A .docx built run by run, so strikethrough can be set per run. */
function docx(runs: { text: string; strike?: string }[]): Uint8Array {
  const body = runs
    .map(
      (run) =>
        `<w:p><w:r>${
          run.strike ? `<w:rPr>${run.strike}</w:rPr>` : ""
        }<w:t>${run.text}</w:t></w:r></w:p>`,
    )
    .join("");

  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`,
    ),
  });
}

describe("a struck run", () => {
  it("is not read", () => {
    const text = readDocxText(
      docx([
        { text: "This criterion stands." },
        { text: "This one was withdrawn.", strike: "<w:strike/>" },
      ]),
    );

    expect(text).toContain("This criterion stands.");
    expect(text).not.toContain("withdrawn");
  });

  it("is not read when it is struck twice", () => {
    const text = readDocxText(
      docx([{ text: "Gone as well.", strike: "<w:dstrike/>" }]),
    );
    expect(text).not.toContain("Gone as well.");
  });

  it("is read when the run switches strikethrough off", () => {
    /*
     * w:val="0" is how a run escapes a style that had strikethrough on.
     * Treating it as a deletion would silently drop live text, which is the
     * worse of the two mistakes.
     */
    for (const off of ['<w:strike w:val="0"/>', '<w:strike w:val="false"/>']) {
      const text = readDocxText(docx([{ text: "Still here.", strike: off }]));
      expect(text).toContain("Still here.");
    }
  });

  it("leaves a document with no strikethrough exactly as it was", () => {
    const plain = docx([{ text: "One" }, { text: "Two" }]);
    expect(readDocxText(plain)).toBe("One\nTwo");
  });

  it("keeps the paragraph, so nothing runs into the line below", () => {
    // The struck run is emptied rather than removed. Dropping the element
    // would merge its line into the next one, and in a table its cell into
    // the neighbouring cell.
    const text = readDocxText(
      docx([
        { text: "Above" },
        { text: "Deleted", strike: "<w:strike/>" },
        { text: "Below" },
      ]),
    );
    expect(text.split("\n").filter(Boolean)).toEqual(["Above", "Below"]);
  });
});

/**
 * The document that found it.
 *
 * Roland struck out four things in the job sheet of 21 September: the launch
 * date paragraph, the whole of item 2.1, one sentence in 4.2 and one in 5.2.
 * I read it twice and carried his deletions back to him as live text both
 * times, which is how two of them ended up in the markdown I wrote from it.
 */
describe("Roland's own edits to the job sheet", () => {
  const path = join(process.cwd(), "JOB-SHEET-2026-09-21.docx");

  it("drops what he struck out", () => {
    const text = readDocxText(new Uint8Array(readFileSync(path)));

    // The whole of 2.1, which he deleted.
    expect(text).not.toContain("Workbooks must open on screen");
    // The launch date paragraph.
    expect(text).not.toContain("Launch has moved");
    // One sentence inside a paragraph whose remainder he kept.
    expect(text).not.toContain("Update it, or supersede it, so the figures agree");
    expect(text).not.toContain("Whether that plan survives is a separate decision");
  });

  it("keeps what he wrote in their place", () => {
    const text = readDocxText(new Uint8Array(readFileSync(path)));

    expect(text).toContain("Leave the note to Linda");
    expect(text).toContain("It has been proven here for NBTC purposes");
    // And everything he never touched.
    expect(text).toContain("Pale grey text must become black");
  });
});
