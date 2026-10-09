/**
 * Reading Curiosa's 121151 papers as they stand on live (job sheet D26, 9
 * October 2026).
 *
 * The "Check and make live" page held 22 items against the qualification. Each
 * was checked against the uploaded files: 18 were the reader failing to match
 * guidance that is in the guides, and 4 were faults in the documents. These
 * tests hold the reader's fixes against copies of the live files in
 * tests/fixtures/121151-live, and hold the documents' faults as things the
 * reader must keep saying until the files are corrected.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocxText } from "@/lib/office";
import { mergeMemorandum, parseMemorandum, parseWorkbook, type ParsedPaper } from "@/lib/capture-parse";

const dir = join(process.cwd(), "tests/fixtures/121151-live");
const text = (name: string) => readDocxText(new Uint8Array(readFileSync(join(dir, name))));
const read = (paper: string, guide = paper.replace(/\.docx$/, " AG.docx")) => mergeMemorandum(parseWorkbook(text(paper)), parseMemorandum(text(guide)));

/** What "Check and make live" holds against a paper: written questions with no guidance, and totals that disagree. */
function heldBack(paper: ParsedPaper): string[] {
  const held: string[] = [];
  for (const section of paper.sections) {
    const sum = Math.round(section.items.reduce((n, item) => n + (item.points ?? 0), 0) * 100) / 100;
    if (section.markTotal !== null && section.markTotal !== sum) held.push(`${section.title}: ${section.markTotal} marks, questions ${sum}`);
    for (const item of section.items) {
      if (item.type === "long_answer" && !item.markingGuide) held.push(`${section.title}: question ${item.number} has no guidance`);
    }
  }
  return held;
}

const guideOf = (paper: ParsedPaper, title: string, number: string) =>
  paper.sections.find((section) => section.title.startsWith(title))!.items.find((item) => item.number === number)!.markingGuide;

describe("the 121151 papers on live", () => {
  // Every pair whose documents are not themselves at fault.
  const clean = [
    "CA 121151 SU1 SA1 V1.docx",
    "CA 121151 SU1 SA1 V2.docx",
    "CA 121151 SU2 WB2.docx",
    "CA 121151 SU3 SA3 V1.docx",
    "CA 121151 SU3 SA3 V2.docx",
    "CA 121151 SU3 WB3.docx",
    "CA 121151 SU3 WB4.docx",
    "CA 121151 SU3 WB5.docx",
    "CA 121151 SU3 WB6.docx",
    "CA 121151 SU3 WB7.docx",
    "CA 121151 SU4 SA4 V1.docx",
    "CA 121151 SU4 SA4 V2.docx",
    "CA 121151 SU4 WB1.docx",
    "CA 121151 SU5 SA5 V1.docx",
  ];

  it.each(clean)("holds nothing back in %s", (paper) => {
    const guide = readdirSync(dir).find((name) => name.replace(/\s*\.docx$/, "") === paper.replace(/\.docx$/, " AG") || name === paper.replace(/\.docx$/, " AG .docx"))!;
    expect(heldBack(read(paper, guide))).toEqual([]);
  });

  it("reads a workbook question whose criteria come before the colon", () => {
    // "Question 3 (IAC0203): International Standards Alignment (SHRM/CIPD) (3 Marks)"
    expect(guideOf(read("CA 121151 SU2 WB2.docx"), "Part D", "3")).toContain("SHRM Standards");
  });

  it("reads a practical task's answer that opens with its rubric", () => {
    // "Task 1 Model Answer: …" then "■ MODEL ANSWER & RUBRIC - PRACTICAL TASK 1"
    expect(guideOf(read("CA 121151 SU2 WB2.docx"), "SECTION 2", "1")).toContain("Gap Analysis Evaluation");
  });

  it("keeps a Part C statement and a Part D question of the same number apart", () => {
    const paper = read("CA 121151 SU2 WB2.docx");
    expect(guideOf(paper, "Part C", "1")).toContain("Correct Answer: FALSE");
    expect(guideOf(paper, "Part D", "1")).toContain("Demand Forecasting");
  });

  it("reads a summative's \"Q1 Model Answer\" and its rubric rows", () => {
    const paper = read("CA 121151 SU3 SA3 V1.docx");
    expect(guideOf(paper, "SECTION C", "1")).toContain("TNA Levels");
    expect(guideOf(paper, "SECTION D", "D2")).toContain("Calibration mechanisms");
  });

  it("reads \"A2.1\" rows under a Version 2 paper's Part A2", () => {
    expect(guideOf(read("CA 121151 SU4 SA4 V2.docx"), "PART A2", "A2.1")).toContain("LRA Schedule 8");
  });

  it("reads statements marked [NEW]", () => {
    expect(guideOf(read("CA 121151 SU2 SA2 V2.docx"), "SECTION B", "6")).toContain("POPIA");
  });

  it("keeps the numbered parts of SU1's Section C questions within them", () => {
    const sectionC = read("CA 121151 SU1 SA1 V1.docx").sections[2];
    expect(sectionC.items.map((item) => [item.number, item.points])).toEqual([
      ["C1", 20],
      ["C2", 20],
      ["C3", 15],
      ["C4", 15],
    ]);
    expect(sectionC.markTotal).toBe(70);
    expect(sectionC.items[0].stem).toContain("Draft the Job Description profile");
  });
});

describe("the faults in the 121151 documents, said until they are corrected", () => {
  it("SU5 SA5 Version 2: the paper and its guide have each other's names", () => {
    const merged = read("CA 121151 SU5 SA5 V2.docx");
    expect(merged.problems.join(" ")).toContain("given each other's names");
  });

  it("SU2 SA2: the learners' papers carry the memorandum", () => {
    for (const paper of ["CA 121151 SU2 SA2 V1.docx", "CA 121151 SU2 SA2 V2.docx"]) {
      expect(read(paper).problems.join(" ")).toContain("carries its own marking guide");
    }
  });

  it("SU4 workbooks 2 and 3: every multiple-choice answer is B", () => {
    for (const paper of ["CA 121151 SU4 WB2.docx", "CA 121151 SU4 WB3.docx"]) {
      expect(read(paper).problems.join(" ")).toContain("has B as the correct answer");
    }
  });

  it("SU5 WB1: Part D is printed as 20 marks and its questions come to 24", () => {
    const merged = read("CA 121151 SU5 WB1 .docx", "CA 121151 SU5 WB1 AG.docx");
    expect(merged.problems).toContain('"Part D: Short Answer Questions" is printed as 20 marks, but its questions add up to 24.');
  });
});
