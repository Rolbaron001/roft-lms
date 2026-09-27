/**
 * The wording as a numbered document for translating, and read back. Job
 * sheet D9, Roland's method, 27 September 2026.
 */
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import refs from "@/lib/i18n/refs.json";
import {
  assignRefs,
  buildPhraseDocument,
  namePlaceholders,
  numberPlaceholders,
  placeTranslations,
  readPhraseLines,
  refLabel,
} from "@/lib/i18n/phrase-document";
import { readDocxText } from "@/lib/office";

const english = en as Record<string, string>;
const refTable = refs as Record<string, number>;
const all = Object.keys(english).map((key) => ({ ref: refTable[key], key, english: english[key] }));

describe("the reference numbers", () => {
  it("give every phrase a number of its own", () => {
    const missing = Object.keys(english).filter((key) => refTable[key] === undefined);
    // If this fails, a phrase was added: run npm run translations:export.
    expect(missing).toEqual([]);
    expect(new Set(Object.values(refTable)).size).toBe(Object.values(refTable).length);
  });

  it("never change or get reused when phrases come and go", () => {
    const later = assignRefs({ a: 1, b: 2, gone: 3 }, ["a", "b", "new"]);
    expect(later).toEqual({ a: 1, b: 2, gone: 3, new: 4 });
  });
});

describe("the document", () => {
  const text = readDocxText(buildPhraseDocument(all, "Platform wording for translation"));

  it("opens as a Word document and carries every phrase on its own numbered line", () => {
    const lines = readPhraseLines(text);
    expect(lines.size).toBe(all.length);
    expect(lines.get(refTable["shell.signOut"])).toBe("Sign out");
    expect(text).toContain(`${refLabel(refTable["shell.signOut"])} Sign out`);
  });

  it("says where each phrase appears, and how to treat the numbers and values", () => {
    expect(text).toMatch(/Keep the number exactly as it is/);
    expect(text).toMatch(/Signing in/);
    expect(text).toMatch(/Work experience/);
  });

  it("writes a value as {1}, never as an English word a translator would translate", () => {
    const line = readPhraseLines(text).get(refTable["learn.lessonsDone"]);
    expect(line).toBe("{1} of {2} done");
    expect(text).not.toMatch(/\{[a-z]\w*\}/);
  });
});

describe("reading a translation back", () => {
  it("puts each line against its phrase by number, and restores the values by name", () => {
    const lines = readPhraseLines(
      [
        "Amagama epulatifomu ahunyushwayo", // a translated title: ignored
        `${refLabel(refTable["shell.signOut"])} Phuma`,
        `${refLabel(refTable["learn.lessonsDone"])} {1} kwezi-{2} kuqediwe`,
      ].join("\n"),
    );
    const result = placeTranslations(lines, refTable, english);
    expect(result.translations["shell.signOut"]).toEqual({ text: "Phuma", from: "Sign out" });
    expect(result.translations["learn.lessonsDone"].text).toBe("{done} kwezi-{total} kuqediwe");
    expect(result.refused).toEqual([]);
  });

  it("follows values a translation has put in a different order", () => {
    const { names } = numberPlaceholders("{done} of {total} done");
    expect(namePlaceholders("{2} kwe-{1}", names)).toBe("{total} kwe-{done}");
  });

  it("reads brackets and numbers a translator has spaced or restyled", () => {
    const lines = readPhraseLines(`[ 0005 ] Phuma\n【0006】 Okunye\n［0007］ Futhi`);
    expect([...lines.keys()]).toEqual([5, 6, 7]);
  });

  it("refuses a line that lost or invented a value, and leaves that phrase in English", () => {
    const ref = refTable["learn.lessonsDone"];
    const lost = placeTranslations(new Map([[ref, "{1} kuqediwe"]]), refTable, english);
    expect(lost.translations["learn.lessonsDone"]).toBeUndefined();
    expect(lost.refused[0]).toMatch(/should carry \{1\} \{2\} and carries \{1\}/);
    const invented = placeTranslations(new Map([[refTable["shell.signOut"], "Phuma {1}"]]), refTable, english);
    expect(invented.refused[0]).toMatch(/should carry no \{values\}/);
  });

  it("reports numbers the platform does not have instead of guessing", () => {
    const result = placeTranslations(new Map([[99999, "Okuthile"]]), refTable, english);
    expect(result.unknown).toEqual([99999]);
  });
});
