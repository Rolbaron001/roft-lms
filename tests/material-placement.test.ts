/**
 * Placing material in a study unit when its name does not say which, read
 * against the provider's alignment document. Every file here is from the
 * SP-260508 RPL Advisor folder Heidi uploaded on 17 November 2026, whose
 * material was all filed against the qualification and so never built.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readDocxText, readPptxText } from "@/lib/office";
import { readAlignmentDocument } from "@/lib/alignment-document";
import { placeMaterial, type PlacementUnit } from "@/lib/material-placement";
import { mergeMemorandum, parseMemorandum, parseWorkbook } from "@/lib/capture-parse";
import { classifyDocument } from "@/lib/folder-plan";
import { artefactNumber } from "@/lib/capture-from-documents";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

let units: PlacementUnit[];
beforeAll(() => {
  units = readAlignmentDocument(readDocxText(fixture("SP260508-alignment.docx"))).studyUnits.map((unit) => ({
    code: unit.code,
    moduleCodes: unit.moduleCodes,
    topics: unit.topics,
  }));
});

describe("the alignment document's topics", () => {
  it("records which topics of a module each study unit takes", () => {
    expect(units.find((unit) => unit.code === "SU1")?.topics).toEqual({ KM01: ["KT01", "KT04"] });
    expect(units.find((unit) => unit.code === "SU2")?.topics).toEqual({ KM01: ["KT03", "KT05"], PM01: ["PS01"], PM02: ["PS02"] });
  });
});

describe("placing by name", () => {
  it("puts a topic's slides in the study unit that teaches the topic", () => {
    expect(placeMaterial(units, { filename: "RPL KM1 KT1.pptx", kind: "theory_guide", text: null })).toMatchObject({ studyUnitCode: "SU1", covers: ["SU1"] });
    expect(placeMaterial(units, { filename: "RPL KM2 KT5.pptx", kind: "theory_guide", text: null })?.studyUnitCode).toBe("SU4");
    expect(placeMaterial(units, { filename: "RPL KM3 KT2 Practical Tools, Templates & Assessment Rubrics.docx", kind: "other", text: null })?.studyUnitCode).toBe("SU5");
  });

  it("asks for a check where the alignment document places the topic nowhere", () => {
    // SP-260508's alignment document never names KM-01 KT02.
    const placed = placeMaterial(units, { filename: "RPL KM1 KT2.pptx", kind: "theory_guide", text: null });
    expect(placed).toMatchObject({ studyUnitCode: "SU2", covers: ["SU1", "SU2"] });
    expect(placed?.because).toMatch(/Check this/);
  });

  it("leaves the FISA with the qualification", () => {
    expect(placeMaterial(units, { filename: "FISA_1_Written_Scenario_Assessment_Instrument.docx", kind: "summative_assessment", text: "KM-01 KM-02 KM-03 PM-01 PM-02" })).toBeNull();
  });
});

describe("placing by what a document covers", () => {
  it("puts a summative after the last study unit it assesses, as the provider's schedule does", () => {
    const text = readDocxText(fixture("SP260508-summative-1.docx"));
    expect(placeMaterial(units, { filename: "Summative_Assessment_1_Governance_Research_Policy.docx", kind: "summative_assessment", text })).toMatchObject({
      studyUnitCode: "SU2",
      covers: ["SU1", "SU2"],
    });
    const guide = readDocxText(fixture("SP260508-summative-1-guide.docx"));
    expect(placeMaterial(units, { filename: "Summative_Assessor_Guide_1_Governance_Research_Policy.docx", kind: "summative_memorandum", text: guide })?.studyUnitCode).toBe("SU2");
  });

  it("puts a workbook in the study unit whose topics it covers", () => {
    const text = readDocxText(fixture("SP260508-workbook-2.docx"));
    expect(placeMaterial(units, { filename: "Formative_Workbook_2_Part2_Operational_Lifecycle.docx", kind: "workbook", text })?.studyUnitCode).toBe("SU3");
  });

  it("does not read a handbook or matrix for coverage, since they cover everything", () => {
    expect(placeMaterial(units, { filename: "Master_Learner_Handbook_RPL_Advisor_NQF7.docx", kind: "learner_handbook", text: "KM-01 KM-02 KM-03" })).toBeNull();
    expect(placeMaterial(units, { filename: "Learning Material Matrix RPL Advisor.docx", kind: "other", text: "KM-01 KM-02 KM-03" })).toBeNull();
  });
});

describe("reading the material itself", () => {
  it("reads the text of a PowerPoint deck", () => {
    const text = readPptxText(fixture("SP260508-KM1-KT4.pptx"));
    expect(text.length).toBeGreaterThan(200);
    expect(text).toMatch(/RPL/);
  });

  it("reads a workbook headed '1.1 Title:' against a guide headed '1.1 Title (Exemplar Key)', every question with its guidance", () => {
    const paper = parseWorkbook(readDocxText(fixture("SP260508-workbook-1.docx")));
    const merged = mergeMemorandum(paper, parseMemorandum(readDocxText(fixture("SP260508-workbook-1-guide.docx"))));
    const items = merged.sections.flatMap((section) => section.items);
    expect(items.map((item) => item.number)).toEqual(["1.1", "1.2", "1.3", "2.1", "2.2", "3.1", "3.2", "4.1", "4.2", "5.1", "5.2", "5.3"]);
    expect(items.filter((item) => !item.markingGuide)).toEqual([]);
    // "Curriculum Mapping: …" is the activity's note, not a question.
    expect(items.some((item) => /^Curriculum Mapping/.test(item.stem))).toBe(false);
  });

  it("files the workbook's guide as a workbook memorandum, and pairs it by number", () => {
    expect(classifyDocument("Learning Material/Assessor_Guide_Memo_Formative_Workbook_1.docx", "Assessor_Guide_Memo_Formative_Workbook_1.docx", 1).kind).toBe("workbook_memorandum");
    expect(artefactNumber("Formative_Workbook_1_Part1_Theory_Governance.docx")).toBe("1");
    expect(artefactNumber("Assessor_Guide_Memo_Formative_Workbook_1.docx")).toBe("1");
    expect(artefactNumber("Summative_Assessor_Guide_2_Implementation_Evidence_Execution.docx")).toBe("2");
  });

  it("takes the answers from a guide that writes them one per line", () => {
    const paper = parseWorkbook(readDocxText(fixture("SP260508-summative-1.docx")));
    const memo = parseMemorandum(readDocxText(fixture("SP260508-summative-1-guide.docx")));
    const merged = mergeMemorandum(paper, memo);
    const trueFalse = merged.sections.find((section) => /True \/ False/i.test(section.title));
    expect(trueFalse?.items.map((item) => item.correctIndex)).toEqual([1, 1, 1, 1, 0]);
    const choice = merged.sections.find((section) => /Multiple/i.test(section.title));
    expect(choice?.items.every((item) => item.correctIndex === 1)).toBe(true);
    expect(merged.problems.filter((problem) => /no correct answer/.test(problem))).toEqual([]);
  });
});
