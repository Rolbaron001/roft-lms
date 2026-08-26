/**
 * Reading a curriculum document into a proposal.
 *
 * Both documents here are real, and they disagree with each other: 121150
 * numbers a module KM01 where 121151 numbers it KM-01, and a PS code is a
 * skill in one and an activity inside a skill in the other. A parser tuned to
 * either one alone looks finished and then reads the other backwards, which is
 * the failure these tests exist to catch.
 *
 * The assertions are deliberately specific — this exact code, this exact
 * count — because the failure that matters is not an exception. It is a
 * proposal that looks right, gets accepted, and puts a work activity inside a
 * knowledge module where every question and assessor decision then references
 * it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/lib/office";
import {
  parseCurriculumText,
  type ParsedCurriculum,
} from "@/lib/curriculum-parse";

async function parseFixture(name: string): Promise<ParsedCurriculum> {
  const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
  const { text } = await readPdfText(bytes);
  return parseCurriculumText(text);
}

describe("parseCurriculumText", () => {
  it("says so plainly when there is nothing to read", () => {
    const result = parseCurriculumText("This is a letter, not a curriculum.");

    expect(result.modules).toEqual([]);
    expect(result.notes[0]).toMatch(/No module headers were found/);
  });

  describe("121150", () => {
    let parsed: ParsedCurriculum;
    beforeAll(async () => {
      parsed = await parseFixture("121150-curriculum.pdf");
    });

    it("finds all thirteen modules, in all three components", () => {
      expect(parsed.modules.map((m) => m.code)).toEqual([
        "KM01",
        "KM02",
        "KM03",
        "KM04",
        "KM05",
        "PM01",
        "PM02",
        "PM03",
        "PM04",
        "WM01",
        "WM02",
        "WM03",
        "WM04",
      ]);
    });

    /**
     * The only things this document leaves over are faults in the document
     * itself, and they are worth naming here because they are invisible on the
     * page: KM02 restarts its criteria at IAC0101 in a second topic while its
     * elements correctly run on to KT0201, and WM01 numbers five different
     * work activities WA0201.
     *
     * The platform requires a criterion code to be unique in its module and an
     * element code unique in its topic, so in both cases only the first can be
     * stored. Saying so before anybody accepts the module is the difference
     * between renumbering four lines and losing them.
     */
    it("reports the document's own numbering faults, and nothing else", () => {
      expect(parsed.notes).toEqual([
        "KM02: the document uses criterion IAC0101 more than once in this entry. Only the first can be stored — the rest need their own codes.",
        "KM02: the document uses criterion IAC0102 more than once in this entry. Only the first can be stored — the rest need their own codes.",
        "KM02: the document uses criterion IAC0103 more than once in this entry. Only the first can be stored — the rest need their own codes.",
        "WM01 / WE0102: the document uses WA0201 more than once. Only the first can be stored — the rest need their own codes.",
      ]);
    });

    it("reads a module's title, credits and level", () => {
      const entry = parsed.modules.find((m) => m.code === "KM01");

      expect(entry?.component).toBe("knowledge");
      expect(entry?.title).toBe(
        "Introduction to Organisations and Human Resource Management",
      );
      expect(entry?.credits).toBe(12);
      expect(entry?.nqfLevel).toBe(5);
    });

    it("reads a topic with the share of the module it carries", () => {
      const topic = parsed.modules
        .find((m) => m.code === "KM01")
        ?.topics.find((t) => t.code === "KM0101");

      expect(topic?.title).toBe("Introduction to Organisational Management");
      expect(topic?.weightPercent).toBe(25);
    });

    it("reads what must be taught, and what it is assessed by", () => {
      const topic = parsed.modules
        .find((m) => m.code === "KM01")
        ?.topics.find((t) => t.code === "KM0101");

      expect(topic?.elements[0]).toEqual({
        code: "KT0101",
        kind: "knowledge_topic",
        description:
          "Definition of an organisation and the generic organisational value chain.",
      });
      expect(topic?.criteria[0]).toEqual({
        code: "IAC0101",
        description:
          "Define an organisation and explain the generic organisational value chain.",
      });
    });

    /**
     * The documents wrap a long description over two and three lines. Joined
     * back together or the second half is simply lost.
     */
    it("puts a description that wrapped back together", () => {
      const topic = parsed.modules
        .find((m) => m.code === "KM01")
        ?.topics.find((t) => t.code === "KM0101");
      const wrapped = topic?.elements.find((e) => e.code === "KT0105");

      expect(wrapped?.description).toBe(
        "Introduction to the different levels of management in organisations (Strategic, Functional, Tactical and Operational).",
      );
    });

    it("reads a practical module as activities and applied knowledge", () => {
      const entry = parsed.modules.find((m) => m.code === "PM01");
      const kinds = new Set(
        entry?.topics.flatMap((t) => t.elements.map((e) => e.kind)),
      );

      expect(entry?.component).toBe("practical");
      expect(kinds).toEqual(new Set(["practical_activity", "applied_knowledge"]));
    });

    /**
     * A work experience module is evidenced by a signed logbook, so it carries
     * no assessment criteria. Reading criteria onto one would create
     * requirements that nothing can ever satisfy.
     */
    it("reads no criteria onto a work experience module", () => {
      const workplace = parsed.modules.filter((m) => m.component === "workplace");

      expect(workplace.length).toBe(4);
      for (const entry of workplace) {
        expect(entry.topics.flatMap((t) => t.criteria)).toEqual([]);
        expect(entry.topics.flatMap((t) => t.elements).length).toBeGreaterThan(
          0,
        );
      }
    });

    it("keeps each kind of line in the component that holds it", () => {
      for (const entry of parsed.modules) {
        const kinds = new Set(
          entry.topics.flatMap((t) => t.elements.map((e) => e.kind)),
        );

        if (entry.component === "knowledge") {
          expect(kinds).toEqual(new Set(["knowledge_topic"]));
        }
        if (entry.component === "workplace") {
          expect([...kinds].every((kind) => kind !== "knowledge_topic")).toBe(
            true,
          );
        }
      }
    });
  });

  describe("121151, which is written to a different convention", () => {
    let parsed: ParsedCurriculum;
    beforeAll(async () => {
      parsed = await parseFixture("121151-curriculum.pdf");
    });

    it("finds all fifteen modules despite the hyphenated codes", () => {
      expect(parsed.modules.length).toBe(15);
      expect(parsed.modules.filter((m) => m.component === "knowledge").length).toBe(
        5,
      );
      expect(parsed.modules.filter((m) => m.component === "practical").length).toBe(
        5,
      );
      expect(parsed.modules.filter((m) => m.component === "workplace").length).toBe(
        5,
      );
    });

    it("reads a module title that wrapped across two lines", () => {
      const entry = parsed.modules.find((m) => m.code === "KM01");

      expect(entry?.title).toBe(
        "Creating and Implementing Organisational Architecture for organisational success and sustainability",
      );
      expect(entry?.credits).toBe(8);
    });

    /**
     * Here a PS code is an activity inside a skill, where in 121150 it is the
     * skill itself. Read the wrong way round this module has thirty-eight
     * topics with nothing in them instead of two with the work under them.
     */
    it("treats a PS code as an activity, not as a skill", () => {
      const entry = parsed.modules.find((m) => m.code === "PM01");

      expect(entry?.topics.map((t) => t.code)).toEqual(["PM0101", "PM0102"]);
      expect(
        entry?.topics[0].elements.some((e) => e.code.startsWith("PS")),
      ).toBe(true);
    });

    /**
     * What was not read has to be said. These are the modules whose topics did
     * not come out, and the notes are the only thing standing between that and
     * a curriculum quietly missing a fifth of itself.
     */
    it("reports what it could not read rather than passing over it", () => {
      const empty = parsed.modules.filter((m) => m.topics.length === 0);

      for (const entry of empty) {
        expect(parsed.notes.some((note) => note.startsWith(entry.code))).toBe(
          true,
        );
      }
    });

    /**
     * A real fault in the document, not in the reading of it: these topic
     * percentages do not come to 100. Worth surfacing to whoever accepts the
     * proposal, since the platform weights topics by them.
     */
    it("reports percentages that do not come to a hundred", () => {
      expect(parsed.notes.some((note) => /come to \d+, not 100/.test(note))).toBe(
        true,
      );
    });
  });
});
