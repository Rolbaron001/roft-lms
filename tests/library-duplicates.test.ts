/**
 * Re-importing a folder must not file its policies again.
 *
 * Roland, 22 September 2026, looking at a library holding every QMS policy
 * four times over: "there's not supposed to be duplicates. The QMS policy
 * shouldn't file 4 times without overwriting with a warning and decision."
 *
 * Thirty-six documents, nine of them distinct, none marked as a copy of any
 * other. Re-importing a folder is an ordinary thing to do, so this is the
 * normal path rather than misuse.
 *
 * lib/programme-documents.ts already solved it for programme material, on the
 * digest rather than the name, and the library was left behind. These tests
 * hold the two halves of the answer together: the commit stops duplicating,
 * and the proposal says so before anybody commits anything.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const records = source("lib/records.ts");

describe("the same bytes are not a new version", () => {
  it("looks for the digest before writing anything", () => {
    expect(records).toMatch(/eq\(libraryDocuments\.contentHash, contentHash\)/);
  });

  it("asks before storing the object, not after", () => {
    // Storing first and then finding the row redundant leaves an orphan
    // object behind on every repeated import.
    const check = records.indexOf("eq(libraryDocuments.contentHash, contentHash)");
    const store = records.indexOf("await putObject(storageKey");
    expect(check).toBeGreaterThan(-1);
    expect(store).toBeGreaterThan(-1);
    expect(check).toBeLessThan(store);
  });

  it("reports that it did nothing rather than reporting a filing", () => {
    expect(records).toMatch(/outcome: "already_held"/);
  });
});

describe("the same title is a new version", () => {
  it("finds the current document of that name and kind", () => {
    expect(records).toMatch(/eq\(libraryDocuments\.title, parsed\.title\)/);
    expect(records).toMatch(/eq\(libraryDocuments\.category, parsed\.category\)/);
    expect(records).toMatch(/eq\(libraryDocuments\.status, "current"\)/);
  });

  it("infers the predecessor only where the caller named none", () => {
    // A caller who picked one in the form means that one.
    expect(records).toMatch(/parsed\.supersedesId\s*\?\?\s*previous\?\.id\s*\?\?\s*null/);
  });

  it("keeps the version it replaces", () => {
    // The policy that governed in March is what an audit of March asks about.
    expect(records).toMatch(/set\(\{ status: "superseded"/);
  });
});

describe("the commit says what it actually did", () => {
  const commit = source("lib/folder-commit.ts");

  it("counts a filing only where something was filed", () => {
    expect(commit).toMatch(/filed\.outcome === "already_held"/);
    expect(commit).toMatch(/already in the library, byte for byte/);
  });

  it("does not silently count a duplicate as a new document", () => {
    // report.libraryDocuments used to be incremented unconditionally, which
    // is how four imports reported thirty-six documents filed.
    expect(commit).not.toMatch(
      /await fileLibraryDocument\(session, \{[\s\S]*?\}\);\s*report\.libraryDocuments \+= 1;/,
    );
  });
});

describe("the warning arrives before the decision", () => {
  const importing = source("lib/folder-import.ts");

  it("checks the library while building the proposal", () => {
    expect(importing).toMatch(/libraryFilingPreview/);
    expect(importing).toMatch(/warnAboutLibraryDuplicates/);
  });

  it("puts it where the proposal screen already reads from", () => {
    // plan.warnings is what the review screen shows and waits on.
    expect(importing).toMatch(/warnings\.push\([\s\S]{0,200}already in the library/);
  });

  it("distinguishes nothing-to-do from something-will-change", () => {
    expect(importing).toMatch(/will not be filed again/);
    expect(importing).toMatch(/kept as superseded/);
  });
});
