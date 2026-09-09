/**
 * What a provider may call things, and what they may not.
 *
 * The feature exists because Roland and Heidi agreed the platform should not
 * force its vocabulary on a provider in another country. The constraint exists
 * because some of those words are not the platform's to lend out: a provider
 * who renamed "qualification" would have changed the wording on a QCTO
 * submission without anybody telling them.
 *
 * The first test is the one that matters. Everything else can be rebuilt from
 * the code; that one holds a rule about a regulator.
 */
import { describe, expect, it } from "vitest";
import { authorityTerms, getDictionary } from "@/lib/dictionary";
import {
  DEFAULT_VOCABULARY,
  TERMS,
  TERM_KEYS,
  vocabulary,
} from "@/lib/terms";

describe("which words may be renamed", () => {
  /**
   * The registry must never offer a term a regulator defines, however
   * convenient it would be. This catches somebody adding "qualification" to
   * the registry in a hurry, which is exactly how this would go wrong.
   */
  it("offers nothing that a regulator defines", () => {
    const reserved = new Set(
      authorityTerms().map((term) => term.toLowerCase()),
    );

    for (const key of TERM_KEYS) {
      const term = TERMS[key];
      expect(
        reserved.has(term.one.toLowerCase()),
        `"${term.one}" is defined by a regulator and must not be renameable`,
      ).toBe(false);
      expect(
        reserved.has(term.many.toLowerCase()),
        `"${term.many}" is defined by a regulator and must not be renameable`,
      ).toBe(false);
    }
  });

  /**
   * Every entry says who defines it, and only two of the dictionary's three
   * classifications may appear. A term marked `authority` in the registry
   * would be a contradiction in terms.
   */
  it("only holds words the platform or the sector owns", () => {
    for (const key of TERM_KEYS) {
      expect(["platform", "practice"]).toContain(TERMS[key].definedBy);
    }
  });

  /** The words a provider most wants are the ones nobody owns. */
  it("includes the words the meeting actually asked about", () => {
    expect(TERM_KEYS).toContain("course");
    expect(TERM_KEYS).toContain("programme");
  });

  /** And excludes the one it must. */
  it("does not include qualification", () => {
    const entry = getDictionary().entries.find(
      (row) => row.term.toLowerCase() === "occupational qualification",
    );
    expect(entry?.definedBy).toBe("authority");
    expect(TERM_KEYS as string[]).not.toContain("qualification");
  });
});

describe("reading the platform in a provider's own words", () => {
  it("uses the standard word when nothing is set", () => {
    expect(DEFAULT_VOCABULARY.one("course")).toBe("Course");
    expect(DEFAULT_VOCABULARY.many("programme")).toBe("Programmes");
    expect(DEFAULT_VOCABULARY.customised).toBe(false);
  });

  it("uses the provider's word where they set one", () => {
    const words = vocabulary({ course: { one: "Unit", many: "Units" } });

    expect(words.one("course")).toBe("Unit");
    expect(words.many("course")).toBe("Units");
    expect(words.customised).toBe(true);
  });

  /**
   * Per key, not wholesale. A provider who renamed one thing in March must
   * still get every other word, and a term added to the platform later must
   * arrive with its default rather than as an empty string.
   */
  it("falls back one word at a time", () => {
    const words = vocabulary({ course: { one: "Unit", many: "Units" } });

    expect(words.one("course")).toBe("Unit");
    expect(words.one("cohort")).toBe("Cohort");
    expect(words.many("learner")).toBe("Learners");
  });

  it("ignores an override that is blank or whitespace", () => {
    const words = vocabulary({ course: { one: "   ", many: "" } });
    expect(words.one("course")).toBe("Course");
    expect(words.customised).toBe(false);
  });

  describe("mid-sentence", () => {
    it("lowercases an ordinary word", () => {
      expect(DEFAULT_VOCABULARY.lowerMany("course")).toBe("courses");
    });

    /**
     * A provider who calls a course a "SETA Module" means those capitals. Only
     * a leading capital followed by lowercase is treated as sentence case, so
     * an acronym or a proper noun survives being used mid-sentence.
     */
    it("leaves a word that carries its own capitals alone", () => {
      const words = vocabulary({
        course: { one: "SETA Module", many: "SETA Modules" },
      });
      expect(words.lowerOne("course")).toBe("SETA Module");
      expect(words.lowerMany("course")).toBe("SETA Modules");
    });
  });
});
