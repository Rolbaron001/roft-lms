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

/**
 * The kinds named in the restricted set, wherever it is declared.
 *
 * Two names by design: the library's is RESTRICTED_TO_ASSESSORS, which reads
 * as what it does at the call sites that enforce it, and the client component
 * keeps a copy called RESTRICTED_KINDS because it cannot import from a module
 * that reaches the database. Both are matched, and the test's whole job is to
 * fail when their contents drift apart.
 */
function restrictedIn(source: string): string[] {
  const block =
    /(?:RESTRICTED_KINDS|RESTRICTED_TO_ASSESSORS)\s*=\s*new Set(?:<[^>]*>)?\(\[([\s\S]*?)\]\)/.exec(
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

/**
 * What the review screen claims about where a plan came from.
 *
 * Roland uploaded 81 files of material on 19 September and was told they had
 * been "read from the folder's own blueprint file" - of a folder that has no
 * blueprint, in a mode that reads no structure at all and never asks a model.
 *
 * The cause was that a material import starts from an empty plan, and the
 * empty plan declared itself "blueprint" because there were only two values to
 * choose from. Provenance is the one thing a review screen must not get wrong:
 * it is the answer to "what looked at my documents", which is a question a
 * provider can be asked about their learners' material.
 */
describe("where the review screen says a plan came from", () => {
  it("has a value for filing, which reads nothing", async () => {
    const { ingestUpload } = await import("@/lib/folder-import");
    // The type is what is asserted here; exercising the whole import needs a
    // tenant and is covered elsewhere.
    expect(typeof ingestUpload).toBe("function");

    const source = readFileSync(join(root, "lib/folder-plan.ts"), "utf8");
    expect(source).toMatch(/"blueprint" \| "documents" \| "filing"/);
  });

  it("does not claim a blueprint was read when none was", () => {
    const plan = readFileSync(join(root, "lib/folder-import.ts"), "utf8");
    const empty = plan.slice(plan.indexOf("function emptyPlan"));
    expect(empty.slice(0, 400)).toMatch(/source: "filing"/);
  });

  it("says plainly that no model was involved", () => {
    expect(proposal).toMatch(/No blueprint and no model were involved/);
  });

  /**
   * "Qualification: Not stated, NQF ? · ? credits, 0 modules, 0 topics, 0
   * elements, 0 criteria" over a successful import of eighty-one documents.
   * Four blanks and five zeroes that look like a failure and are a success.
   */
  it("hides the curriculum summary on a run that reads no curriculum", () => {
    expect(proposal).toMatch(/plan\.source === "filing" \? \(/);
    expect(proposal).toMatch(/hidden=\{plan\.source === "filing"\}/);
  });
});

/**
 * Where a successful commit leaves you.
 *
 * Roland, having committed 81 documents: "What now? Shouldn't there be
 * navigation to upload workbooks and assessments? Or at least take me to the
 * Qualification page."
 *
 * The commit returned a sentence - "Committed: 0 modules, 0 topics, ... 81
 * documents." - and stopped. No link, no redirect, nothing but the browser's
 * back button, at the end of the longest single action in the platform.
 *
 * The report has carried the qualification id all along; nothing passed it on.
 */
describe("after a commit succeeds", () => {
  it("says where the work went", () => {
    const actions = readFileSync(join(root, "app/imports/actions.ts"), "utf8");
    expect(actions).toMatch(/committedTo\?: string;/);
    expect(actions).toMatch(/committedTo: report\.qualificationId/);
  });

  it("offers the way on rather than a dead end", () => {
    expect(proposal).toMatch(/state\.committedTo \? \(/);
    expect(proposal).toMatch(/Open the qualification/);
  });
});
