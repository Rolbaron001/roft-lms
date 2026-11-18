/**
 * Linking documents by what they say when their names do not (Roland, 18
 * November 2026: "the app must read the documents (starting with the file
 * names) to identify a link"). The documents are real: SP-260508's and
 * 121151's. The names are deliberately scrambled, as a provider's may be.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocxText } from "@/lib/office";
import { answerByTitle, bestGuide, headingsOf, kindFromContent } from "@/lib/document-linking";

const text = (name: string) => readDocxText(new Uint8Array(readFileSync(join(__dirname, "fixtures", name))));

describe("finding a paper's guide by its content", () => {
  const paper = { filename: "doc-0193.docx", text: text("SP260508-workbook-1.docx") };
  const guides = [
    { id: "decoy-summative", filename: "doc-0412.docx", text: text("SP260508-summative-1-guide.docx") },
    { id: "the-guide", filename: "doc-0007.docx", text: text("SP260508-workbook-1-guide.docx") },
  ];

  it("reads the same question headings in the paper and its guide", () => {
    expect(headingsOf(paper.text).length).toBeGreaterThanOrEqual(10);
  });

  it("picks the guide that answers the paper's questions, whatever either is called", () => {
    const link = bestGuide(paper, guides);
    expect(link?.id).toBe("the-guide");
    expect(link?.because).toMatch(/answers \d+ of the paper's \d+ question headings/);
  });

  it("does not guess between two guides that are equally likely", () => {
    expect(bestGuide(paper, [guides[1], { ...guides[1], id: "a-copy" }])).toBeNull();
  });

  it("does not pick a guide that answers none of it", () => {
    expect(bestGuide(paper, [guides[0]])).toBeNull();
  });
});

describe("the same, on another provider's papers (Curiosa's 121151)", () => {
  // Every 121151 paper with its guide among all the others, every name scrambled.
  const pairs = [
    ["121151-su1-wb2.docx", "121151-su1-wb2-ag.docx"],
    ["121151-su3-wb3.docx", "121151-su3-wb3-ag.docx"],
    ["121151-su5-wb1.docx", "121151-su5-wb1-ag.docx"],
    ["121151-su2-sa2-v1.docx", "121151-su2-sa2-v1-ag.docx"],
    ["121151-su5-sa5-v1.docx", "121151-su5-sa5-v1-ag.docx"],
  ];
  const guides = pairs.map(([, guide], index) => ({ id: guide, filename: `file-${index}.docx`, text: text(guide) }));

  it.each(pairs)("finds %s's guide, or leaves it to a person, and never picks a wrong one", (paper, guide) => {
    const link = bestGuide({ filename: "untitled.docx", text: text(paper) }, guides);
    if (link) expect(link.id).toBe(guide);
  });

  it("finds most of them", () => {
    const found = pairs.filter(([paper, guide]) => bestGuide({ filename: "untitled.docx", text: text(paper) }, guides)?.id === guide);
    expect(found.length).toBeGreaterThanOrEqual(3);
  });
});

describe("matching a question to its answer by title", () => {
  it("finds the answer headed with the question's words, and only a clear one", () => {
    const answers = [
      { title: "4.1 National Policy & Statutory Sub-Framework Mapping (Exemplar Key)" },
      { title: "4.2 International Comparative Policy Analysis (Evaluation Rubric)" },
    ];
    expect(answerByTitle("International Comparative Policy Analysis Compare the RPL policy of two countries", answers)?.title).toMatch(/^4\.2/);
    expect(answerByTitle("Write a reflective journal entry", answers)).toBeNull();
  });
});

describe("what a document is, from its content", () => {
  it("tells a workbook's guide, a summative's guide and a workbook apart", () => {
    expect(kindFromContent(text("SP260508-workbook-1-guide.docx"))).toBe("workbook_memorandum");
    expect(kindFromContent(text("SP260508-summative-1-guide.docx"))).toBe("summative_memorandum");
    expect(kindFromContent(text("SP260508-workbook-1.docx"))).toBe("workbook");
  });
});
