/**
 * A paper the alignment document lists for two study units (Roland and Heidi,
 * 19 November 2026). SP-260508's updated alignment lists Formative Workbook 1
 * and Summative Assessment 1 for both SU1 and SU2; SU1 showed "No workbooks or
 * assessments yet". Read against Heidi's own document.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocxText } from "@/lib/office";
import { bestAlignmentUnits, paperKeysIn, readAlignmentDocument } from "@/lib/alignment-document";
import { paperKey, placeMaterial } from "@/lib/material-placement";

const text = readDocxText(new Uint8Array(readFileSync(join(__dirname, "fixtures", "SP260508-alignment-2.docx"))));

describe("the papers each study unit lists", () => {
  it("are read from the alignment rows, not the schedule after them", () => {
    const units = readAlignmentDocument(text).studyUnits;
    expect(units.map((unit) => [unit.code, unit.papers])).toEqual([
      ["SU1", ["workbook:1", "summative:1"]],
      ["SU2", ["workbook:1", "summative:1"]],
      ["SU3", ["workbook:2", "summative:2"]],
      ["SU4", ["workbook:2", "summative:2"]],
      ["SU5", ["workbook:3", "summative:3"]],
    ]);
  });

  it("does not take a schedule's 'Summative Assessment 1 & 2' as one paper", () => {
    expect(paperKeysIn("Summative Assessment 1 & 2")).toEqual([]);
    expect(paperKeysIn("Summative Assessment 1 (Governance, Research & Policy) & Assessor Guide")).toEqual(["summative:1"]);
  });

  it("prefers the alignment document that lists papers", () => {
    const older = readDocxText(new Uint8Array(readFileSync(join(__dirname, "fixtures", "SP260508-alignment.docx"))));
    expect(bestAlignmentUnits([older, text, null])[0].papers).toEqual(["workbook:1", "summative:1"]);
  });
});

describe("placing a shared paper", () => {
  const units = readAlignmentDocument(text).studyUnits.map((unit) => ({ code: unit.code, moduleCodes: unit.moduleCodes, topics: unit.topics, papers: unit.papers }));

  it("puts it in the last unit that lists it, and says which units it covers", () => {
    expect(placeMaterial(units, { filename: "Formative_Workbook_1_Part1_Theory_Governance.docx", kind: "workbook", text: null })).toMatchObject({
      studyUnitCode: "SU2",
      covers: ["SU1", "SU2"],
    });
    expect(placeMaterial(units, { filename: "Formative_Workbook_2_Part2_Operational_Lifecycle.docx", kind: "workbook", text: null })).toMatchObject({
      studyUnitCode: "SU4",
    });
    expect(placeMaterial(units, { filename: "Assessor_Guide_Memo_Formative_Workbook_2.docx", kind: "workbook_memorandum", text: null })?.studyUnitCode).toBe("SU4");
    expect(placeMaterial(units, { filename: "Summative_Assessor_Guide_3_Ethics_Mediation_Resilience_Updated.docx", kind: "summative_memorandum", text: null })?.studyUnitCode).toBe("SU5");
  });

  it("leaves a FISA with the qualification", () => {
    expect(paperKey("FISA_1_Written_Scenario_Assessment_Instrument.docx", "summative_assessment")).toBeNull();
    expect(placeMaterial(units, { filename: "FISA_1_Written_Scenario_Assessment_Instrument.docx", kind: "summative_assessment", text: null })).toBeNull();
  });
});
