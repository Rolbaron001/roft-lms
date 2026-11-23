/**
 * SP-220320, Assessment Practitioner (Roland, 23 November 2026, job sheet
 * D59): "Linking study units, workbooks and assessor guides still seems to be
 * a problem. The scheduling matrix provides the links and all the documents
 * are there, but the links aren't made."
 *
 * Its papers are lettered, not numbered (Part A, B, C), each question is a
 * line like "Task 1.1 [IAC0101]  [9 Marks]", and its formative guides never
 * say "workbook". Read against Curiosa's own files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocxText } from "@/lib/office";
import { mergeMemorandum, parseMemorandum, parseWorkbook } from "@/lib/capture-parse";
import { readAlignmentDocument } from "@/lib/alignment-document";
import { classifyDocument } from "@/lib/folder-plan";
import { paperKey, placeMaterial } from "@/lib/material-placement";
import { artefactNumber } from "@/lib/capture-from-documents";

const text = (name: string) => readDocxText(new Uint8Array(readFileSync(join(__dirname, "fixtures", name))));

describe("SP-220320's schedule and alignment", () => {
  const units = readAlignmentDocument(text("SP220320-alignment.docx")).studyUnits;

  it("takes the focus area as the title, not '(Part A)'", () => {
    expect(units.map((unit) => unit.title)).toEqual([
      "Programme Orientation, Occupational Profile & ELO 6 Framework",
      "Assessment Principles, Evidence Collection, Evaluation & QMS Governance",
      "Simulated Practical Execution & Authentic Workplace Assessment (3 Candidates)",
    ]);
  });

  it("reads the modules from each unit's own row, with the curriculum's full identifier, not from the schedule", () => {
    expect(units.map((unit) => unit.moduleCodes)).toEqual([["WM06"], ["KM05"], ["PM06", "WM06"]]);
  });

  it("reads each unit's lettered workbook and summative", () => {
    expect(units.map((unit) => unit.papers)).toEqual([
      ["workbook:1", "summative:1"],
      ["workbook:2", "summative:2"],
      ["workbook:3", "summative:3"],
    ]);
  });

  it("places each paper and guide in its own unit", () => {
    const placing = units.map((unit) => ({ code: unit.code, moduleCodes: unit.moduleCodes, topics: unit.topics, papers: unit.papers }));
    const where = (filename: string) => placeMaterial(placing, { filename, kind: classifyDocument(`Learning Matrial/${filename}`, filename, 1).kind, text: null })?.studyUnitCode;
    expect(where("Formative_Workbook_Part_A.docx")).toBe("SU1");
    expect(where("Formative_Assessor_Guide_Part_A.docx")).toBe("SU1");
    expect(where("Summative_Assessment_Part_B_Script.docx")).toBe("SU2");
    expect(where("Assessor_Guide_Part_B.docx")).toBe("SU2");
    expect(where("Formative_Workbook_Part_C.docx")).toBe("SU3");
  });
});

describe("SP-220320's file names", () => {
  it("files a formative guide as the workbook's guide, though it never says 'workbook'", () => {
    expect(classifyDocument("Learning Matrial/Formative_Assessor_Guide_Part_A.docx", "Formative_Assessor_Guide_Part_A.docx", 1).kind).toBe("workbook_memorandum");
    expect(classifyDocument("Learning Matrial/Assessor_Guide_Part_A.docx", "Assessor_Guide_Part_A.docx", 1).kind).toBe("summative_memorandum");
  });

  it("reads a part letter as its number", () => {
    expect(artefactNumber("Formative_Workbook_Part_B.docx")).toBe("2");
    expect(artefactNumber("Formative_Assessor_Guide_Part_B.docx")).toBe("2");
    expect(paperKey("Summative_Assessment_Part_C_Script.docx", "summative_assessment")).toBe("summative:3");
    expect(paperKey("Formative_Workbook_1_Part1_Theory_Governance.docx", "workbook")).toBe("workbook:1");
  });
});

describe("SP-220320's papers, each read with its guide", () => {
  for (const part of ["A", "B", "C"]) {
    for (const [paper, guide] of [
      [`SP220320-workbook-${part}.docx`, `SP220320-workbook-${part}-guide.docx`],
      [`SP220320-summative-${part}.docx`, `SP220320-summative-${part}-guide.docx`],
    ]) {
      it(`${paper}: real questions only, 100 marks, every one with guidance`, () => {
        const merged = mergeMemorandum(parseWorkbook(text(paper)), parseMemorandum(text(guide)));
        const items = merged.sections.flatMap((section) => section.items);
        expect(items.length).toBeGreaterThanOrEqual(9);
        expect(items.reduce((sum, item) => sum + (item.points ?? 0), 0)).toBe(100);
        expect(items.filter((item) => (item.markedBy === "assessor" ? !item.markingGuide : item.correctIndex === null))).toEqual([]);
        expect(items.some((item) => /^(?:PART [A-C]:|Duration:|MANDATORY|Structured Developmental)/i.test(item.stem))).toBe(false);
        expect(merged.problems).toEqual([]);
      });
    }
  }
});
