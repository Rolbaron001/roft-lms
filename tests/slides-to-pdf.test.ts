/**
 * PowerPoint decks to PDF (job sheet D56; Roland, 19 November 2026). The
 * deck is SP-260508's own "RPL KM1 KT4.pptx", one of the twelve that
 * LibreOffice refused with "General input/output error" because a script had
 * written three package parts with "ns0:" prefixes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { convertDeck, isDeck, pdfPageCount, repairDeck, slideCount } from "@/lib/slides-to-pdf";

const deck = new Uint8Array(readFileSync(join(__dirname, "fixtures", "SP260508-KM1-KT4.pptx")));

const sofficeHere = (() => {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
})();

describe("a deck with prefixed package parts", () => {
  it("is repaired in exactly the parts that carry the fault, and nothing else", async () => {
    const { bytes, repaired } = await repairDeck(deck);
    expect(repaired.sort()).toEqual(["[Content_Types].xml", "ppt/_rels/presentation.xml.rels", "ppt/presentation.xml"]);
    const zip = await JSZip.loadAsync(bytes);
    const types = await zip.files["[Content_Types].xml"].async("string");
    expect(types).toMatch(/<Types xmlns="http:\/\/schemas\.openxmlformats\.org\/package\/2006\/content-types"/);
    expect(types).not.toMatch(/ns0:/);
    // The slides themselves are untouched.
    const before = await (await JSZip.loadAsync(deck)).files["ppt/slides/slide1.xml"].async("string");
    expect(await zip.files["ppt/slides/slide1.xml"].async("string")).toBe(before);
  });

  it("leaves a clean deck exactly as it was", async () => {
    const { bytes: once } = await repairDeck(deck);
    const again = await repairDeck(once);
    expect(again.repaired).toEqual([]);
    expect(again.bytes).toBe(once);
  });

  it("counts its slides", async () => {
    expect(await slideCount(deck)).toBeGreaterThan(0);
  });
});

describe("telling a deck apart and counting a PDF's pages", () => {
  it("knows a deck by its type or its name", () => {
    expect(isDeck("RPL KM1 KT4.pptx", null)).toBe(true);
    expect(isDeck("guide.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
  });

  it("counts pages, not the page tree", () => {
    const pdf = new TextEncoder().encode("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page >>");
    expect(pdfPageCount(pdf)).toBe(2);
  });
});

/*
 * The conversion itself, where LibreOffice is installed (it is in the image;
 * on a developer's machine it may not be). Proves the repaired deck converts
 * with one page per slide, which the original did not.
 */
describe.skipIf(!sofficeHere)("converting with LibreOffice", () => {
  it("turns the repaired deck into a PDF with one page per slide", async () => {
    const { bytes } = await repairDeck(deck);
    const pdf = await convertDeck(bytes);
    expect(pdfPageCount(pdf)).toBe(await slideCount(bytes));
  }, 200_000);
});
