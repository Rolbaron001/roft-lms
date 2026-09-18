/**
 * Saying who will be able to open these documents, before they are committed.
 *
 * This is the one consequence on the confirmation screen that cannot be undone
 * by noticing afterwards. A memorandum filed as something unrestricted is
 * handed to the learners it is the answer key for, at the moment of commit,
 * silently. Thirty-eight of Curiosa's own documents were heading that way
 * before the naming rules learned "WB1 AG" and "SA1 V1 AG" - all 81 files were
 * recognised, and 66 of them were filed as "other", which is withheld from
 * nobody.
 *
 * The rules are better now and they are still only rules about filenames.
 * Curiosa's folder holds two files nobody has explained, "HRM Officer SU2
 * TM.pdf" and "HRM Officer SU2 WP.pdf", which are filed as "other" because the
 * honest answer is that the platform does not know. That is right - guessing
 * is what would be dangerous - but it means the screen has to say what "other"
 * costs, rather than listing eighty-one lines and leaving somebody to work it
 * out.
 *
 * The restricted list is repeated in the client component, because the module
 * that owns it reaches the database and cannot be imported into a browser
 * bundle. A copy is only honest if something fails when the two drift, which
 * is what the first test here is.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const proposal = readFileSync(
  join(root, "app/imports/[id]/proposal.tsx"),
  "utf8",
);
const documents = readFileSync(
  join(root, "lib/programme-documents.ts"),
  "utf8",
);

/** The kinds named in a `RESTRICTED_KINDS` set, wherever it is declared. */
function restrictedIn(source: string): string[] {
  const block = /RESTRICTED_KINDS\s*=\s*new Set(?:<[^>]*>)?\(\[([\s\S]*?)\]\)/.exec(
    source,
  );
  if (!block) return [];
  return Array.from(block[1].matchAll(/"([a-z_]+)"/g))
    .map((match) => match[1])
    .sort();
}

describe("what the confirmation screen says about visibility", () => {
  it("withholds exactly what the library withholds", () => {
    const onScreen = restrictedIn(proposal);
    const inLibrary = restrictedIn(documents);

    expect(inLibrary.length).toBeGreaterThan(0);
    expect(onScreen).toEqual(inLibrary);
  });

  it("states the two counts before the list rather than inside it", () => {
    expect(proposal).toMatch(/withheld from learners/);
    expect(proposal).toMatch(/visible to them/);
  });

  it("names the catch-all, because that is where an unknown name lands", () => {
    expect(proposal).toMatch(/could not be recognised/);
    expect(proposal).toMatch(/visible to everyone/);
  });

  it("marks each line, so scanning answers it without counting", () => {
    expect(proposal).toMatch(/withheld\s*<\/span>/);
    expect(proposal).toMatch(/not recognised · visible to all/);
  });

  /**
   * A document with no kind at all has to count as unrecognised. Treating
   * null as "fine" is how the dangerous case gets through: nothing was
   * matched, so nothing was restricted.
   */
  it("counts a document with no kind as unrecognised", () => {
    expect(proposal).toMatch(/!one\.kind \|\| one\.kind === "other"/);
    expect(proposal).toMatch(/!document\.kind \|\| document\.kind === "other"/);
  });
});
