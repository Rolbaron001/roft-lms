/**
 * Reading Curiosa's Study Unit 5 summative assessment. Job sheet D10,
 * 27 September 2026.
 *
 * Roland captured SA5 and was shown eighteen problems he could not tell apart:
 * mistakes in the material, or the platform misreading it. Checked against the
 * originals, almost all were the platform's. These hold each fix against the
 * real files (tests/fixtures), which is the only way to know it works.
 *
 * The Version 2 files really are named the wrong way round in Curiosa's
 * folder: "V2" is the assessor guide and "V2 AG" the learner's script. The
 * fixtures keep that, named for what each file is called and what it is.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withPhrases } from "./helpers/phrases";
import { readDocxText } from "@/lib/office";
import { mergeMemorandum, parseMemorandum, parseWorkbook } from "@/lib/capture-parse";
import { chooseGuide, versionOf } from "@/lib/capture-from-documents";

function text(name: string): string {
  return readDocxText(new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures", `121151-su5-sa5-${name}.docx`))));
}

const V1 = text("v1");
const V1_GUIDE = text("v1-ag");
// What each Version 2 file actually is.
const V2 = text("v2-named-as-guide");
const V2_GUIDE = text("v2-named-as-paper");

describe("Version 1, read with its own guide", () => {
  const merged = mergeMemorandum(parseWorkbook(V1), parseMemorandum(V1_GUIDE));
  const [a, b, c, d] = merged.sections;

  it("finds its four sections and their 100 marks, with nothing to fix", () => {
    expect(merged.sections.map((s) => [s.markTotal, s.items.length])).toEqual([
      [15, 15],
      [20, 5],
      [15, 3],
      [50, 4],
    ]);
    expect(merged.problems).toEqual([]);
  });

  it("reads the instruction as an instruction, and its mark per question", () => {
    expect(a.instruction).toMatch(/^Select the SINGLE best answer/);
    expect(a.markEach).toBe(1);
    expect(a.items.map((item) => item.points)).toEqual(Array(15).fill(1));
  });

  it("finds all fifteen answers in a guide that numbers them Q1, Q2", () => {
    expect(a.items.map((item) => "ABCD"[item.correctIndex!]).join("")).toBe("CBBBCBBBBCBABBB");
  });

  it("counts five statements, not their writing lines, and finds no copies", () => {
    expect(b.items.map((item) => item.number)).toEqual(["1", "2", "3", "4", "5"]);
    expect(merged.problems.some((p) => /appears twice/.test(p))).toBe(false);
  });

  it("reads marks written in square brackets", () => {
    expect(c.items.map((item) => item.points)).toEqual([5, 5, 5]);
    // The title keeps its own bracket, and the question's text follows it.
    expect(c.items[0].stem).toMatch(/^Root Cause Analysis \(5 Whys Technique\) Apply the '5 Whys'/);
  });

  it("reads each sub-section of the long question as a part with its own marks", () => {
    expect(d.items.map((item) => [item.number, item.points])).toEqual([
      ["D1", 13],
      ["D2", 13],
      ["D3", 12],
      ["D4", 12],
    ]);
  });

  it("does not read the case study as questions", () => {
    const stems = merged.sections.flatMap((s) => s.items.map((item) => item.stem));
    expect(stems.some((stem) => /^Background: Apex Logistics/.test(stem))).toBe(false);
  });
});

describe("Version 2, its files taken for what they are", () => {
  it("reads cleanly, in its own order", () => {
    const merged = mergeMemorandum(parseWorkbook(V2), parseMemorandum(V2_GUIDE));
    expect(merged.sections.map((s) => [s.title.split(":")[0], s.markTotal, s.items.length])).toEqual([
      ["PART A1", 15, 3],
      ["PART A2", 50, 4],
      ["SECTION B", 15, 15],
      ["SECTION C", 20, 5],
    ]);
    expect(merged.problems).toEqual([]);
  });
});

describe("a paper and its guide with each other's names", () => {
  it("says only that, when the guide is really a learner's paper", () => {
    const merged = mergeMemorandum(parseWorkbook(V1), parseMemorandum(V2));
    expect(merged.problems).toHaveLength(1);
    expect(merged.problems[0]).toMatch(/reads like the learner's paper.*each other's names/);
  });

  it("says so when the paper is really a marking guide", () => {
    const merged = mergeMemorandum(parseWorkbook(V2_GUIDE), parseMemorandum(V2));
    expect(merged.problems.some((p) => /reads like a marking guide/.test(p))).toBe(true);
    expect(merged.problems.every((p) => /each other's names/.test(p))).toBe(true);
  });

  it("is the only thing the review screen shows", () => {
    const screen = withPhrases(readFileSync(join(process.cwd(), "app/capture/[id]/review-form.tsx"), "utf8"));
    expect(screen).toMatch(/The paper and the guide look swapped/);
  });
});

describe("pairing a filed paper with its guide", () => {
  const guides = [{ filename: "CA 121151 SU5 SA5 V2 AG.docx" }, { filename: "CA 121151 SU5 SA5 V1 AG.docx" }];

  it("reads the version from the name", () => {
    expect(versionOf("CA 121151 SU5 SA5 V2 AG.docx")).toBe("2");
    expect(versionOf("Summative Version 3.docx")).toBe("3");
    expect(versionOf("CA 121151 SU5 WB1 AG.docx")).toBeNull();
  });

  it("gives each version its own guide, whichever was filed first", () => {
    expect(chooseGuide("CA 121151 SU5 SA5 V1.docx", guides)?.filename).toBe("CA 121151 SU5 SA5 V1 AG.docx");
    expect(chooseGuide("CA 121151 SU5 SA5 V2.docx", guides)?.filename).toBe("CA 121151 SU5 SA5 V2 AG.docx");
  });

  it("never gives a paper another version's guide, and lets one unversioned guide serve all", () => {
    expect(chooseGuide("CA 121151 SU5 SA5 V3.docx", guides)).toBeNull();
    expect(chooseGuide("CA 121151 SU5 SA5 V3.docx", [{ filename: "CA 121151 SU5 SA5 AG.docx" }])?.filename).toBe(
      "CA 121151 SU5 SA5 AG.docx",
    );
  });
});
