/**
 * "Check the map" (job sheet D60; Roland, 24 November 2026). Two real folders
 * run through the readers, the placement and the pairing, as the folder
 * upload does, and the map checked: what it asks, what it offers for a tick,
 * and what an answer changes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocxText } from "@/lib/office";
import { bestAlignmentUnits } from "@/lib/alignment-document";
import { classifyDocument, type IngestionPlan } from "@/lib/folder-plan";
import { placeMaterial } from "@/lib/material-placement";
import { applyAnswer, confirmAll, mapOf, pairPapers } from "@/lib/programme-map";

const design = join(__dirname, "..", "..", "..", "Design", "Skills Programmes");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** A folder read the way the upload reads it, without the database. */
function planOf(folder: string): IngestionPlan {
  const root = join(design, folder);
  const files = walk(root).filter((path) => /\.(docx|pptx|pdf)$/i.test(path));
  const documents = files.map((path) => classifyDocument(relative(root, path).replace(/\\/g, "/"), path.split(/[\\/]/).pop()!, 1));
  const texts = new Map<string, string | null>();
  for (const [index, path] of files.entries()) texts.set(documents[index].path, path.endsWith(".docx") ? readDocxText(new Uint8Array(readFileSync(path))) : null);
  const alignment = documents.filter((one) => one.kind === "alignment_matrix" || one.kind === "rollout_schedule").map((one) => texts.get(one.path) ?? null);
  const units = bestAlignmentUnits(alignment).map((unit) => ({ code: unit.code, moduleCodes: unit.moduleCodes, topics: unit.topics, papers: unit.papers }));
  for (const document of documents) {
    if (document.studyUnitCode || document.target === "library") continue;
    const placed = placeMaterial(units, { filename: document.filename, kind: document.kind, text: texts.get(document.path) ?? null });
    if (!placed) continue;
    document.studyUnitCode = placed.studyUnitCode;
    document.target = "study_unit";
    document.source = placed.source ?? "content";
    document.also = placed.covers.filter((code) => code !== placed.studyUnitCode);
  }
  const plan: IngestionPlan = {
    source: "readers",
    qualification: { title: folder, saqaId: null, curriculumCode: null, nqfLevel: null, credits: null, purpose: null },
    modules: [],
    studyUnits: bestAlignmentUnits(alignment).map((unit) => ({ code: unit.code, title: unit.title })),
    documents,
    warnings: [],
  };
  pairPapers(plan, texts);
  return plan;
}

const here = (folder: string) => existsSync(join(design, folder));

describe.skipIf(!here("SP220320 Assessment Practitioner"))("SP-220320 on 'Check the map'", () => {
  it("pairs every paper with its guide and asks nothing", () => {
    const plan = planOf("SP220320 Assessment Practitioner");
    const map = mapOf(plan);
    const papers = map.items.filter((item) => item.role === "paper");
    expect(papers.map((item) => [item.title, item.unit, item.guide?.title])).toEqual(
      expect.arrayContaining([
        ["Formative Workbook Part A", "SU1", "Formative Assessor Guide Part A"],
        ["Summative Assessment Part B Script", "SU2", "Assessor Guide Part B"],
        ["Formative Workbook Part C", "SU3", "Formative Assessor Guide Part C"],
      ]),
    );
    expect(map.counts.decide).toBe(0);
  });
});

describe.skipIf(!here("SP 260508 RPL Advisor"))("SP-260508 on 'Check the map'", () => {
  const plan = planOf("SP 260508 RPL Advisor");

  it("pairs the workbooks and summatives with their guides", () => {
    const map = mapOf(plan);
    const paired = map.items.filter((item) => item.role === "paper" && item.guide);
    expect(paired.length).toBe(6);
    expect(map.items.filter((item) => item.question === "guide")).toEqual([]);
  });

  it("offers shared items for a tick, and one 'Tick all' makes it ready", () => {
    const map = mapOf(plan);
    const shared = map.items.find((item) => item.title.startsWith("Formative Workbook 1"));
    expect(shared?.also).toEqual(["SU1"]);
    expect(shared?.state).toBe("look");
    if (map.counts.decide === 0) {
      confirmAll(plan);
      expect(mapOf(plan).ready).toBe(true);
    }
  });
});

describe("answers on 'Check the map'", () => {
  const base = (): IngestionPlan => ({
    source: "filing",
    qualification: { title: "T", saqaId: null, curriculumCode: null, nqfLevel: null, credits: null, purpose: null },
    modules: [],
    studyUnits: [
      { code: "SU1", title: "One" },
      { code: "SU2", title: "Two" },
    ],
    documents: [
      { path: "a/Workbook 1.docx", filename: "Workbook 1.docx", bytes: 1, target: "qualification", kind: "workbook", category: null, studyUnitCode: null, title: "Workbook 1", version: null, because: "" },
      { path: "a/Answers.docx", filename: "Answers.docx", bytes: 1, target: "qualification", kind: "workbook_memorandum", category: null, studyUnitCode: null, title: "Answers", version: null, because: "" },
      { path: "a/Notes.docx", filename: "Notes.docx", bytes: 1, target: "qualification", kind: "other", category: null, studyUnitCode: null, title: "Notes", version: null, because: "" },
    ],
    warnings: [],
  });

  it("asks one plain question per gap, and is ready once each is answered", () => {
    const plan = base();
    let map = mapOf(plan);
    expect(map.items.map((item) => [item.title, item.question])).toEqual([
      ["Workbook 1", "unit"],
      ["Answers", "paper"],
      ["Notes", "what"],
    ]);
    applyAnswer(plan, { path: "a/Workbook 1.docx", field: "unit", value: "SU2" });
    applyAnswer(plan, { path: "a/Answers.docx", field: "paper", value: "a/Workbook 1.docx" });
    applyAnswer(plan, { path: "a/Notes.docx", field: "ignore" });
    map = mapOf(plan);
    expect(map.ready).toBe(true);
    expect(plan.documents[0].guidePath).toBe("a/Answers.docx");
  });

  it("does not ask for a study unit where the programme has none, as in a course", () => {
    const plan = { ...base(), studyUnits: [] };
    expect(mapOf(plan).items[0].question).toBe("guide");
  });

  it("asks for a paper's guide again when its guide is left out", () => {
    const plan = base();
    applyAnswer(plan, { path: "a/Workbook 1.docx", field: "unit", value: "SU1" });
    applyAnswer(plan, { path: "a/Workbook 1.docx", field: "guide", value: "a/Answers.docx" });
    expect(mapOf(plan).items[0].state).toBe("settled");
    applyAnswer(plan, { path: "a/Answers.docx", field: "ignore" });
    expect(mapOf(plan).items[0].question).toBe("guide");
  });

  it("lets a paper be marked as having no guide on purpose", () => {
    const plan = base();
    applyAnswer(plan, { path: "a/Workbook 1.docx", field: "unit", value: "SU1" });
    applyAnswer(plan, { path: "a/Workbook 1.docx", field: "guide", value: "none" });
    expect(mapOf(plan).items[0].state).toBe("settled");
  });
});
