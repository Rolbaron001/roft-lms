/**
 * Reading PDFs.
 *
 * The two curriculum documents here are the real ones, because the failure
 * that matters is not an exception — it is text that comes out looking
 * plausible with the codes mangled. KT0101 arriving as KT0IOI would pass any
 * test written against a document made up for the purpose, and would then be
 * transcribed into a qualification and referenced by every question, lesson
 * and assessor decision downstream.
 *
 * So these assert against codes that are actually in the documents.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPdfText, OfficeReadError } from "@/lib/office";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
}

/**
 * A PDF written out by hand: one page, one line of text, no compression.
 * Enough to be valid, and small enough to reason about.
 */
function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

describe("readPdfText", () => {
  it("reads a page of text", async () => {
    const result = await readPdfText(minimalPdf("Hello curriculum"));

    expect(result.pages).toBe(1);
    expect(result.text).toContain("Hello curriculum");
  });

  it("refuses a file that is not a PDF", async () => {
    await expect(
      readPdfText(new TextEncoder().encode("this is not a PDF at all")),
    ).rejects.toThrow(OfficeReadError);
  });

  /**
   * A scan parses perfectly and yields nothing. Left undetected it would file
   * cleanly, sit in the library looking imported, and help with nothing.
   */
  it("says when a document holds no text", async () => {
    const result = await readPdfText(minimalPdf(""));

    expect(result.looksScanned).toBe(true);
  });

  describe("the 121150 curriculum document", () => {
    it("reads every page", async () => {
      const result = await readPdfText(fixture("121150-curriculum.pdf"));

      expect(result.pages).toBe(85);
      expect(result.looksScanned).toBe(false);
    });

    it("recovers the codes the curriculum is built from", async () => {
      const { text } = await readPdfText(fixture("121150-curriculum.pdf"));

      // Modules, and one of each kind of line inside them. These are the
      // identifiers everything downstream references.
      expect(text).toContain("KM01");
      expect(text).toContain("PM01");
      expect(text).toContain("WM01");
      expect(text).toContain("KT0101");
      expect(text).toContain("PA0101");
      expect(text).toContain("AK0101");
      expect(text).toContain("WA0101");
      expect(text).toContain("IAC0101");
    });

    it("recovers the title and the qualification code", async () => {
      const { text } = await readPdfText(fixture("121150-curriculum.pdf"));

      expect(text).toContain("Human Resource Management");
      expect(text).toContain("441601-001-00-00");
    });

    /**
     * The tail of a table, not just its first rows. A reader that drops the
     * end of a long table is the kind that looks like it works.
     *
     * Counted as occurrences rather than distinct codes on purpose: this
     * document reuses IAC0101 in every module that has a first criterion, so
     * a criterion code is unique within its module and nowhere wider.
     */
    it("recovers every criterion line, not just the first few", async () => {
      const { text } = await readPdfText(fixture("121150-curriculum.pdf"));
      const found = text.match(/\bIAC\d{4}\b/g) ?? [];

      expect(found.length).toBe(181);
      expect(new Set(found).size).toBe(48);
    });
  });

  describe("the 121151 curriculum document", () => {
    it("recovers its codes too", async () => {
      const { text, looksScanned } = await readPdfText(
        fixture("121151-curriculum.pdf"),
      );

      expect(looksScanned).toBe(false);
      expect(text).toContain("KT0101");
      expect(text).toContain("WM01");
      expect(new Set(text.match(/\bIAC\d{4}\b/g) ?? []).size).toBe(50);
    });
  });
});
