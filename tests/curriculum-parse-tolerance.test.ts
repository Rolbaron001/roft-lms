/**
 * Whether the reader depends on content or on layout.
 *
 * Two published QCTO documents do not make a house style. The platform is
 * multi-tenant, and the next tenant's curriculum will come from a different
 * development quality partner, a later template revision, or a different
 * typesetter — and it will say the same things in slightly different words.
 * A reader tuned to the two documents on hand looks finished right up until
 * that happens.
 *
 * So each case below takes a real document and changes one thing about how it
 * is laid out, never what it says: a synonym in a heading, a field left off, a
 * different way of writing a code. The qualification is unchanged in every one
 * of them, so the reading should be too.
 *
 * These are regression tests for specific failures, not hypotheticals. Before
 * the change that added them:
 *
 *   "Credit Value" instead of "Credits"    15 modules -> 0
 *   no credits printed on the header       15 modules -> 0
 *   no NQF level printed on the header     15 modules -> 0
 *   "Assessment Criteria" without
 *     "Internal" in front of it            151 criteria -> 0
 *   topics without their (nn%)             151 criteria -> 48
 *
 * The last two are the ones worth dwelling on. Both leave every module and
 * every topic in place and remove only the assessment criteria — so the screen
 * fills with a qualification that looks read, and the thing every learner is
 * eventually judged against is silently absent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/lib/office";
import { parseCurriculumText } from "@/lib/curriculum-parse";

let document: string;

beforeAll(async () => {
  const bytes = new Uint8Array(
    readFileSync(join(__dirname, "fixtures", "121151-curriculum.pdf")),
  );
  document = (await readPdfText(bytes)).text;
});

function read(text: string) {
  const parsed = parseCurriculumText(text);
  let topics = 0;
  let criteria = 0;

  for (const entry of parsed.modules) {
    topics += entry.topics.length;
    for (const topic of entry.topics) criteria += topic.criteria.length;
  }

  return { modules: parsed.modules.length, topics, criteria };
}

/**
 * What the document actually contains, read as published. Asserted here so a
 * change that quietly loses content fails on the baseline rather than passing
 * every variation at a lower number.
 */
const EXPECTED = { modules: 15, topics: 51, criteria: 154 };

describe("reading is not tied to one document's layout", () => {
  it("reads the document as published", () => {
    expect(read(document)).toEqual(EXPECTED);
  });

  const sameQualificationDifferentPage: [string, (text: string) => string][] = [
    [
      "credits headed 'Credit Value'",
      (t) => t.replace(/Credits\s+(\d+)/g, "Credit Value $1"),
    ],
    [
      "criteria headed without the word 'Internal'",
      (t) => t.replace(/Internal Assessment Criteria/g, "Assessment Criteria"),
    ],
    [
      "elements headed 'Topic elements to be covered'",
      (t) => t.replace(/Topic Elements/g, "Topic elements to be covered"),
    ],
    [
      "performance headed 'Practical skills required'",
      (t) => t.replace(/Required Performance/g, "Practical skills required"),
    ],
    [
      "module codes hyphenated as KM-01",
      (t) => t.replace(/\b(KM|PM|WM)(\d{2})\b/g, "$1-$2"),
    ],
    [
      "headings numbered, as 3.2 Applied knowledge",
      (t) => t.replace(/^(Applied knowledge)/gm, "3.2 $1"),
    ],
    [
      "no NQF level printed on the module header",
      (t) => t.replace(/,?\s*NQF\s+Level\s+\d+/gi, ""),
    ],
  ];

  for (const [what, change] of sameQualificationDifferentPage) {
    it(`reads the same qualification with ${what}`, () => {
      expect(read(change(document))).toEqual(EXPECTED);
    });
  }

  /**
   * Credits genuinely absent are a different matter from credits worded
   * differently: there is nothing to read, and the modules must still arrive
   * so that somebody can type them in. Losing the curriculum over a missing
   * number is the failure being guarded against.
   */
  it("still reads the curriculum when no credits are printed at all", () => {
    const withoutCredits = document.replace(/,?\s*Credits?\s+\d+/g, "");
    const parsed = parseCurriculumText(withoutCredits);

    expect(read(withoutCredits)).toEqual(EXPECTED);
    expect(parsed.modules.every((entry) => entry.credits === 0)).toBe(true);
  });

  /**
   * The knowledge topics carry a percentage of the module, and that percentage
   * used to be what identified them. A document that omits it kept its modules
   * and lost two thirds of its topics and criteria without saying so.
   */
  it("reads knowledge topics that carry no percentage", () => {
    const flat = document.replace(/\s*\(\s*\d{1,3}\s*%\s*\)/g, "");

    const parsed = read(flat);
    expect(parsed.modules).toBe(EXPECTED.modules);
    expect(parsed.criteria).toBeGreaterThanOrEqual(EXPECTED.criteria);
  });

  /**
   * Tolerance has a limit, and it is here: a topic belongs to the module whose
   * number it carries. Reading KM03's topics into KM04 is not a lenient
   * reading, it is a wrong one, and it showed up as a module whose topic
   * percentages came to 200.
   */
  it("does not read one module's topics into another", () => {
    const parsed = parseCurriculumText(document);

    for (const entry of parsed.modules) {
      const number = entry.code.slice(2);
      for (const topic of entry.topics) {
        const shaped = /^[A-Z]{2}(\d{2})\d{2}$/.exec(topic.code);
        if (shaped) expect(shaped[1]).toBe(number);
      }
    }
  });
});
