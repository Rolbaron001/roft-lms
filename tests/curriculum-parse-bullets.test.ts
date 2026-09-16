/**
 * The Commercial Cleaner curriculum, and the bullet nobody could see.
 *
 * SAQA 118709 imported thin from the day it was first tried: twenty-two
 * modules and ninety-two topics landed, and not one internal assessment
 * criterion. Recorded as "imports thin" and carried for days, because the
 * shape of the failure hides the cause — a qualification with every module and
 * every topic present looks like it worked, and nobody opens all
 * twenty-two modules to find that the thing competence is judged against is
 * missing from every one of them.
 *
 * The cause was a single character. A bullet typed in Word is not U+2022; it
 * is a glyph from the Symbol font, which maps into the Unicode Private Use
 * Area, so it arrives as U+F0B7. It is not whitespace, so trimming a line
 * leaves it. Every pattern in the reader is anchored at the start of a line.
 * 1,164 of them, one in front of every element and every criterion in the
 * document.
 *
 * Three faults were found underneath it once the lines could be read at all,
 * and each has its own case below:
 *
 *   bullets unreadable                  0 criteria
 *   page furniture taken as text        33 descriptions with a page footer
 *                                       glued to the end of them
 *   sections listed but not announced   6 topics reading empty
 *
 * The second is the one worth dwelling on. A curriculum runs its lists across
 * a page break, and the line after a coded one is taken as its continuation
 * because descriptions genuinely do wrap — so "Work flow" became "Work flow
 * 811201-000-00-000 COMMERCIAL CLEANER -CURRICULUM 21", and nobody reading it
 * afterwards could tell whether the document had said that.
 *
 * Tested against the published document rather than an invented one, because
 * none of this would have been reached by reasoning about it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/lib/office";
import { parseCurriculumText, type ParsedCurriculum } from "@/lib/curriculum-parse";

let text: string;
let parsed: ParsedCurriculum;

beforeAll(async () => {
  const bytes = new Uint8Array(
    readFileSync(join(process.cwd(), "tests/fixtures/118709-curriculum.pdf")),
  );
  const read = await readPdfText(bytes);
  text = read.text;
  parsed = parseCurriculumText(text);
}, 60_000);

function every() {
  return parsed.modules.flatMap((module) =>
    module.topics.flatMap((topic) => [...topic.elements, ...topic.criteria]),
  );
}

describe("the bullet itself", () => {
  it("leaves no private-use glyph in the text at all", () => {
    const leftover = [...text].filter((character) => {
      const point = character.codePointAt(0)!;
      return point >= 0xe000 && point <= 0xf8ff;
    });

    expect(leftover).toEqual([]);
  });

  it("keeps the bullet rather than deleting it", () => {
    // The document did say "this is a list item". Translating preserves that;
    // deleting would throw it away to make the matching easier.
    expect(text).toContain("• KT0101");
  });
});

describe("what the document actually holds", () => {
  it("reads every module", () => {
    expect(parsed.modules).toHaveLength(22);
  });

  /**
   * The number that was zero. Any figure in the low hundreds would show the
   * fault is fixed; the exact one is asserted so that a change which halves it
   * fails here rather than being noticed by a moderator.
   */
  it("reads the internal assessment criteria", () => {
    const criteria = parsed.modules.flatMap((module) =>
      module.topics.flatMap((topic) => topic.criteria),
    );

    expect(criteria.length).toBe(182);
  });

  it("reads what has to be taught", () => {
    const elements = parsed.modules.flatMap((module) =>
      module.topics.flatMap((topic) => topic.elements),
    );

    expect(elements.length).toBe(592);
  });

  it("gives every knowledge module criteria, not just most of them", () => {
    const starved = parsed.modules
      .filter((module) => module.component === "knowledge")
      .filter((module) =>
        module.topics.every((topic) => topic.criteria.length === 0),
      );

    expect(starved.map((module) => module.code)).toEqual([]);
  });
});

describe("what a page does, rather than what it says", () => {
  it("keeps the running footer out of the descriptions", () => {
    const polluted = every().filter((item) =>
      /811201-000-00-000/.test(item.description),
    );

    expect(polluted.map((item) => `${item.code}: ${item.description}`)).toEqual(
      [],
    );
  });

  it("keeps a page number out of the descriptions", () => {
    // A number on the end of a description is how a page number arrives. The
    // document has no element that legitimately ends in a bare number.
    const polluted = every().filter((item) => /\s\d{1,3}$/.test(item.description));

    expect(polluted.map((item) => `${item.code}: ${item.description}`)).toEqual(
      [],
    );
  });

  it("keeps the topic weight off the last criterion", () => {
    const polluted = every().filter((item) => /\(weight/i.test(item.description));

    expect(polluted.map((item) => `${item.code}: ${item.description}`)).toEqual(
      [],
    );
  });

  it("carries a list on across the page break it was interrupted by", () => {
    // KT0402 and KT0403 are separated by the footer and a page number. Losing
    // the rest of a list at a page break would be the obvious wrong way to
    // deal with furniture.
    const topic = parsed.modules
      .flatMap((module) => module.topics)
      .find((one) => one.code.endsWith("KT04") && one.elements.length > 0);

    expect(topic?.elements.map((element) => element.code)).toContain("KT0403");
  });
});

describe("a topic that lists its content without announcing it", () => {
  /**
   * KM-03-KT01 has no "Topic elements to be covered include:" line. Its nine
   * elements follow the heading directly, and were dropped in silence while
   * the note said the topic had nothing to teach.
   */
  it("reads elements that follow the heading directly", () => {
    const topic = parsed.modules
      .flatMap((module) => module.topics)
      .find((one) => one.code === "KM-03-KT01");

    expect(topic).toBeDefined();
    expect(topic!.elements.length).toBeGreaterThanOrEqual(9);
    expect(topic!.elements[0].description).toContain("top to bottom");
  });

  it("still tells a criterion from something to be taught", () => {
    const topic = parsed.modules
      .flatMap((module) => module.topics)
      .find((one) => one.code === "KM-03-KT01");

    // IAC is the QCTO's own abbreviation, and those lines sit under the same
    // topic. Sweeping them in as things to teach would be worse than dropping
    // them: a criterion filed as content is assessed against nothing.
    expect(topic!.elements.some((one) => /^IAC/.test(one.code))).toBe(false);
    expect(topic!.criteria.length).toBe(4);
  });
});

describe("what it still refuses to guess at", () => {
  /**
   * The document contradicts itself in places, and the reader's job is to say
   * so rather than to tidy it away. These notes are the evidence that it
   * still does — a reader that reports nothing is not obviously better than
   * one that reports everything.
   */
  it("reports the faults the document really has", () => {
    const notes = parsed.notes ?? [];

    // A module lists a practical skill in its summary and then never gives
    // guidelines for it.
    expect(notes.join(" ")).toContain("PM-01-PS03");
    // Two codes are used twice in the document.
    expect(notes.join(" ")).toContain("more than once");
    // One module's topic weights do not come to 100.
    expect(notes.join(" ")).toContain("not 100");
  });

  it("has far less to complain about than it did", () => {
    // 128 notes before, nearly all of them "nothing to teach was read" and
    // "no assessment criteria were read" against topics that had both.
    expect((parsed.notes ?? []).length).toBeLessThan(20);
  });
});
