/**
 * Linking a captured question to the criteria it assesses (2 October 2026).
 *
 * Tested against the real 121151 documents: the curriculum as the platform
 * reads it from the PDF (criteria numbered within each topic, "IAC0301"), the
 * same curriculum as a folder's summary records it (numbered straight through
 * each module, "242303-001-00-KM-01-IAC10"), and SU1's second workbook, which
 * writes "IAC0301" and names its topics in its activity headings. Before this,
 * the same capture linked nothing under the second form and SU1 showed 0 of 31
 * criteria covered.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hintsIn, resolveCriterion, resolvePaperCriteria, type CriterionCandidate } from "@/lib/criterion-resolve";
import { mergeMemorandum, parseMemorandum, parseWorkbook } from "@/lib/capture-parse";
import { parseCurriculumText } from "@/lib/curriculum-parse";
import { readDocxText, readPdfText } from "@/lib/office";

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures", name)));

/** SU1's modules, as candidates, in either of the two numbering schemes. */
const shortForm: CriterionCandidate[] = [];
const longForm: CriterionCandidate[] = [];
let paper: ReturnType<typeof mergeMemorandum>;
let paperText: string;

beforeAll(async () => {
  const { text } = await readPdfText(fixture("121151-curriculum.pdf"));
  const curriculum = parseCurriculumText(text);
  const su1 = curriculum.modules.filter((m) => /^(KM|PM|WM)0?1$/.test(m.code));
  for (const curriculumModule of su1) {
    let straightThrough = 0;
    for (const topic of curriculumModule.topics) {
      topic.criteria.forEach((criterion, index) => {
        straightThrough += 1;
        const base = { moduleCode: curriculumModule.code, topicCode: topic.code, positionInTopic: index + 1 };
        shortForm.push({ ...base, id: `${curriculumModule.code}/${criterion.code}`, code: criterion.code });
        longForm.push({
          ...base,
          id: `${curriculumModule.code}/${criterion.code}`,
          moduleCode: `242303-001-00-${curriculumModule.code.replace(/^([A-Z]+)/, "$1-")}`,
          code: `242303-001-00-${curriculumModule.code.replace(/^([A-Z]+)/, "$1-")}-IAC${straightThrough}`,
        });
      });
    }
  }
  paperText = readDocxText(fixture("121151-su1-wb2.docx"));
  paper = mergeMemorandum(parseWorkbook(paperText), parseMemorandum(readDocxText(fixture("121151-su1-wb2-ag.docx"))));
});

describe("reading which module or topic a paper means", () => {
  it("finds topic and module codes however they are written", () => {
    expect(hintsIn("Activity 2.1: Multiple Choice Questions (KM0103 & KM0104)")).toEqual([
      { module: "KM01", topic: "KM0103" },
      { module: "KM01", topic: "KM0104" },
    ]);
    expect(hintsIn("SECTION 1: KNOWLEDGE MODULE 05 (KM-05) ASSESSMENT")).toEqual([{ module: "KM05", topic: null }]);
    expect(hintsIn("Practical Skill: PM0501 - Facilitate")).toEqual([{ module: "PM05", topic: "PM0501" }]);
  });
});

describe("linking the real SU1 workbook to the real curriculum", () => {
  it("links every code on the paper when the curriculum numbers criteria within topics", () => {
    const { perItem, unresolved } = resolvePaperCriteria(paper, shortForm, paperText);
    expect(unresolved).toEqual([]);
    const linked = new Set(perItem.flat(2));
    expect(linked.size).toBe(9);
    // All in KM01, under the two topics the workbook names.
    for (const id of linked) expect(id).toMatch(/^KM01\/IAC0[34]0\d$/);
  });

  it("links the same criteria when the curriculum numbers them straight through each module", () => {
    const short = resolvePaperCriteria(paper, shortForm, paperText).perItem;
    const long = resolvePaperCriteria(paper, longForm, paperText);
    expect(long.unresolved).toEqual([]);
    expect(long.perItem).toEqual(short);
  });
});

describe("a code that could mean more than one criterion", () => {
  const candidates: CriterionCandidate[] = [
    { id: "km", code: "KM-01-IAC10", moduleCode: "KM-01", topicCode: "KM0103", positionInTopic: 1 },
    { id: "pm", code: "PM-01-IAC3", moduleCode: "PM-01", topicCode: "PM0103", positionInTopic: 1 },
  ];

  it("takes the module the paper names around the question", () => {
    expect(resolveCriterion("IAC0301", candidates, [hintsIn("Practical Skill: PM0103")])).toEqual({ id: "pm" });
    expect(resolveCriterion("IAC0301", candidates, [hintsIn("Activity 1 (KM0103)")])).toEqual({ id: "km" });
  });

  it("links nothing, and says why, when the paper does not say", () => {
    const result = resolveCriterion("IAC0301", candidates, []);
    expect(result.id).toBeNull();
    expect("reason" in result && result.reason).toMatch(/could be any of 2 criteria/);
  });

  it("never reaches outside the study unit", () => {
    expect(resolveCriterion("IAC0901", candidates, []).id).toBeNull();
  });
});
