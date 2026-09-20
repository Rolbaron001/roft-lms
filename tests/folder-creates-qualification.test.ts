/**
 * The folder route can create the qualification it just read.
 *
 * Roland, 20 September: he emptied the platform, read the 121151 folder with
 * Claude Code on production - which worked, and reported 15 modules, 52
 * topics, 331 elements, 160 criteria, 5 study units and 81 documents - and
 * then met "Into which qualification" with nothing in the list and no way
 * past. "There is no qualification to save to in the selection box, so nothing
 * can be committed. But, it is clear from the top of the page that the
 * qualification was properly read."
 *
 * He was exactly right about both halves. `commitPlan` required an existing
 * qualification and had no branch that made one, so the folder route could
 * read a whole qualification and never create it - it could only add to one
 * built some other way first. "Build it from a folder" was a promise the
 * screen could not keep, and it only showed when the platform was empty, which
 * is precisely when somebody is most likely to try it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const commit = source("lib/folder-commit.ts");
const proposal = source("app/imports/[id]/proposal.tsx");
const actions = source("app/imports/actions.ts");

describe("committing a folder read as a new qualification", () => {
  it("creates one when none was chosen", () => {
    expect(commit).toMatch(/if \(!qualificationId && job\.target\?\.mode === "qualification"\)/);
    expect(commit).toMatch(/await createQualification\(session, \{/);
  });

  it("carries across what the plan already knew", () => {
    // The title, the SAQA id, the curriculum code, the level and the credits
    // were all in the plan. Nothing was missing except the step that used them.
    for (const field of [
      "title: details.title.trim()",
      "curriculumCode: details.curriculumCode",
      "saqaId: details.saqaId",
      "nqfLevel: details.nqfLevel",
      "totalCredits: details.credits",
    ]) {
      expect(commit).toContain(field);
    }
  });

  it("refuses where the curriculum code is already held", () => {
    // Two qualifications on one code is an ambiguity nothing downstream can
    // resolve - the same rule the documents route enforces.
    expect(commit).toMatch(/already carries the curriculum code/);
    expect(commit).toMatch(/Choose it above to add this folder to it instead/);
  });

  it("refuses rather than creating something untitled", () => {
    expect(commit).toMatch(/no title was found in it/);
  });

  it("says a qualification was created, not just what was counted", () => {
    expect(commit).toMatch(/createdQualification\?: string \| null/);
    expect(actions).toMatch(/report\.createdQualification/);
    expect(actions).toMatch(/Created "\$\{report\.createdQualification\}"/);
  });
});

describe("the screen that asks where it goes", () => {
  it("offers creating it as the default", () => {
    expect(proposal).toMatch(/Create it:/);
    // Not required any more: an empty value now means "make one". Sliced to
    // the select itself rather than a character count - "required" appears
    // legitimately further down the same form.
    const from = proposal.indexOf('target.mode === "qualification" ? (');
    const select = proposal.slice(
      proposal.indexOf("<select", from),
      proposal.indexOf("</select>", from),
    );
    expect(select).not.toMatch(/required/);
  });

  it("still allows adding to one that exists", () => {
    expect(proposal).toMatch(/Or add it to one already here/);
  });

  it("does not offer an empty list of existing ones", () => {
    // With nothing on the platform the group would be an empty box under a
    // heading, which is how this looked when it was broken.
    expect(proposal).toMatch(/qualifications\.length > 0 \? \(/);
  });
});
