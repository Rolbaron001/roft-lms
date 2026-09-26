/**
 * Where a work experience module stops.
 *
 * Found on 18 September by loading the real 121151 into a local tenant and
 * reading the qualification screen to the bottom. The last supporting-evidence
 * line of the last work experience module read:
 *
 *   "SE05 Signed Off Logbook. The following is a broad description of the work
 *   exposure that the learner must have... 4.4 SECTION 4D: STATEMENT OF WORK
 *   EXPERIENCE Curriculum Number 242303-001-00-00: Curriculum Title Advanced
 *   Occupational Certificate: HRM Officer WORK EXPERIENCE MODULES INCLUDED IN
 *   THIS STATEMENT"
 *
 * 571 characters, of which 552 are the document's own plumbing, presented on
 * screen as something a learner must be taught and a coach must sign off.
 *
 * The cause is the one thing this parser has to get right repeatedly: a
 * description genuinely wraps onto the next line, so an uncoded line is taken
 * as a continuation. The running footer between the list and the next section
 * was already skipped as furniture - correctly, because a page break
 * interrupts a list without ending it - and skipping keeps collecting, so the
 * section heading after it joined on anyway.
 *
 * Counts are asserted alongside, because the first attempt at this rule
 * contained an empty alternative, matched every line, and silently took the
 * document from 503 elements to none. A boundary rule that ends everything
 * looks exactly like a boundary rule that works, if you only check the thing
 * you were fixing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/lib/office";
import { parseCurriculumText, type ParsedCurriculum } from "@/lib/curriculum-parse";

let parsed: ParsedCurriculum;

beforeAll(async () => {
  const { text } = await readPdfText(
    readFileSync(join(__dirname, "fixtures", "121151-curriculum.pdf")),
  );
  parsed = parseCurriculumText(text);
}, 120_000);

function everyElement() {
  return parsed.modules.flatMap((module) =>
    module.topics.flatMap((topic) =>
      topic.elements.map((element) => ({
        where: `${module.code}/${topic.code}/${element.code}`,
        description: element.description,
      })),
    ),
  );
}

describe("the end of the work experience section", () => {
  it("leaves the last line of the last module as the document wrote it", () => {
    const se05 = everyElement().find(
      (one) => one.where === "WM05/WE0504/SE05",
    );

    expect(se05?.description).toBe("Signed Off Logbook.");
  });

  it("puts no section heading or preamble inside an element", () => {
    const polluted = everyElement()
      .filter((one) =>
        /SECTION\s+\d|broad description of the work exposure|Curriculum (Number|Title)|MODULES INCLUDED IN THIS STATEMENT/i.test(
          one.description,
        ),
      )
      .map((one) => one.where);

    expect(polluted).toEqual([]);
  });

  /**
   * The guard on the fix itself. A rule that ends the section everywhere
   * removes the fault and the curriculum with it.
   */
  it("still reads the whole curriculum", () => {
    expect(parsed.modules).toHaveLength(15);
    expect(parsed.modules.flatMap((one) => one.topics)).toHaveLength(51);
    expect(everyElement().length).toBeGreaterThan(490);

    const criteria = parsed.modules.flatMap((module) =>
      module.topics.flatMap((topic) => topic.criteria),
    );
    // 160 since 27 September: six KM-04 criteria recovered.
    expect(criteria).toHaveLength(160);
  });
});

/**
 * A footer that does not begin with the curriculum code.
 *
 * The full qualification documents print "242303-001-00-00: HRM Officer 73",
 * which the furniture rule already knew. The skills programme documents print
 * "SP Cur Assessment Practitioner 5 20 Page 9 of 16", which begins with words
 * and so fell through - landing on the end of whatever element was being read
 * when the page broke.
 */
describe("a skills programme document's page footer", () => {
  it("does not end up inside an element", async () => {
    const { text } = await readPdfText(
      readFileSync(join(__dirname, "fixtures", "sp220320-curriculum.pdf")),
    );
    const programme = parseCurriculumText(text);

    const carrying = programme.modules.flatMap((module) =>
      module.topics.flatMap((topic) =>
        topic.elements
          .filter((element) => /Page\s+\d+\s+of\s+\d+/i.test(element.description))
          .map((element) => `${module.code}/${topic.code}/${element.code}`),
      ),
    );

    expect(carrying).toEqual([]);
    // And the document still reads, which is the half that is easy to lose.
    expect(programme.modules).toHaveLength(3);
  }, 120_000);
});
