/**
 * Reading Curiosa's 121151 workbooks and the SU2 summative. Job sheet D10,
 * 27 September 2026, after SU5's assessment (capture-su5.test.ts).
 *
 * All 28 papers in the qualification were run through the reader, and each
 * complaint was checked against the document to tell a reader fault from a
 * fault in the material. These hold the reader's fixes against copies of the
 * real files, and hold the material's faults as things it must keep saying.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocxText } from "@/lib/office";
import { mergeMemorandum, parseMemorandum, parseWorkbook } from "@/lib/capture-parse";

function text(name: string): string {
  return readDocxText(new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures", `121151-${name}.docx`))));
}

function read(paper: string) {
  return mergeMemorandum(parseWorkbook(text(paper)), parseMemorandum(text(`${paper}-ag`)));
}

const marks = (section: { items: { points: number | null }[] }) => section.items.map((item) => item.points);

describe("half marks", () => {
  const merged = read("su3-wb3");

  it("gives two statements worth 5 marks between them 2.5 each", () => {
    const partC = merged.sections.find((s) => s.title.startsWith("Part C"))!;
    expect(partC.markTotal).toBe(5);
    expect(marks(partC)).toEqual([2.5, 2.5]);
  });

  it("reads the whole workbook with nothing to fix", () => {
    expect(merged.sections.map((s) => [s.markTotal, s.items.length])).toEqual([
      [5, 5],
      [5, 5],
      [5, 2],
      [15, 5],
      [20, 2],
    ]);
    expect(merged.problems).toEqual([]);
  });

  it("reads a printed half mark, with a point or a comma", () => {
    const paper = parseWorkbook(
      ["SECTION A: Statements (5 Marks)", "Question 1: First (2,5 Marks)", "Question 2: Second (2.5 Marks)"].join("\n"),
    );
    expect(marks(paper.sections[0])).toEqual([2.5, 2.5]);
  });
});

describe("marks given only in the guide", () => {
  it("takes each task's marks from the guide when the paper prints none", () => {
    const merged = read("su1-wb2");
    const tasks = merged.sections[2];
    expect(tasks.items.map((item) => [item.number, item.points])).toEqual([
      ["A", 25],
      ["B", 25],
    ]);
    // The paper and the guide word the activity differently; its label is enough.
    expect(tasks.title).toMatch(/^Activity 2\.3: SLA Drafting/);
    expect(tasks.markTotal).toBe(50);
    expect(merged.problems.some((p) => /total of 56/.test(p))).toBe(false);
  });

  it("never gives a task's marks to a question of another part with the same number", () => {
    const merged = read("su3-wb3");
    const partC = merged.sections.find((s) => s.title.startsWith("Part C"))!;
    expect(partC.items.every((item) => item.points === 2.5)).toBe(true);
  });

  it("gives a guide's question marks only to questions of the part they are under", () => {
    // The guide's "Question 1 (5 Marks)" is Section C's, not statement 1 of B.
    const merged = read("su2-sa2-v1");
    expect(marks(merged.sections[1])).toEqual([4, 4, 4, 4, 4]);
    expect(marks(merged.sections[2])).toEqual([5, 5, 5]);
  });
});

describe("a learner's paper that carries its own answers", () => {
  const merged = read("su2-sa2-v1");

  it("stops at the memorandum and says so", () => {
    expect(merged.problems).toHaveLength(1);
    expect(merged.problems[0]).toMatch(/^The learner's paper carries its own marking guide, from "MEMORANDUM/);
  });

  it("reads the four sections before it, and none of the answers as questions", () => {
    expect(merged.sections.map((s) => [s.title.split(":")[0], s.markTotal, s.items.length])).toEqual([
      ["SECTION A", 15, 15],
      ["SECTION B", 20, 5],
      ["SECTION C", 15, 3],
      ["SECTION D", 50, 4],
    ]);
  });
});

describe("a workbook with a knowledge part and a practical part", () => {
  const merged = read("su5-wb1");

  it("reads the module's particulars as particulars, not questions", () => {
    const stems = merged.sections.flatMap((s) => s.items.map((item) => item.stem));
    expect(stems.some((stem) => /^(Module Title|Focus|Practical Skill|Case Study Scenario):/.test(stem))).toBe(false);
  });

  it("reads four tasks with their marks from the guide, and each task whole", () => {
    const practical = merged.sections.at(-1)!;
    expect(practical.markTotal).toBe(65);
    expect(practical.items.map((item) => [item.number, item.points])).toEqual([
      ["1", 15],
      ["2", 15],
      ["3", 15],
      ["4", 20],
    ]);
    // Task 2's numbered root-cause headings are part of it, not questions.
    expect(practical.items[1].stem).toMatch(/Workload & Systems Alignment Root Cause:/);
  });

  it("reports Part D's marks, which disagree in both documents", () => {
    // Printed 4, 6, 4, 6, 4 against each question, and 20 for the part.
    expect(merged.problems).toEqual([
      '"Part D: Short Answer Questions" is printed as 20 marks, but its questions add up to 24.',
    ]);
  });
});
