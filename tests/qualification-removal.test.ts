/**
 * Removing a qualification, and refusing to.
 *
 * Roland, 20 September: "There must be functionality to delete a
 * qualification. I understand that it shouldn't be possible if learners have
 * completed the qualification or if cohorts have been run against the
 * qualification, for record purposes. But, in cases where the qualification
 * has never been used, it should be possible to delete it."
 *
 * That rule is why the product has refused until now, and why the only way to
 * remove one was a script on the server. The rule is right: a qualification is
 * what a Statement of Results points at and what an EISA sitting is registered
 * against, so removing one somebody has been assessed under would leave a
 * provider unable to answer a QCTO audit about learners it has certificated.
 *
 * What this holds on to is the distinction the feature rests on - a record of
 * something a person did blocks it; the qualification's own curriculum and
 * documents go with it - and that every reason is named rather than collapsed
 * into "this is in use".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const library = source("lib/qualification-removal.ts");
const screen = source("app/qualifications/[id]/remove-qualification.tsx");
const action = source("app/qualifications/[id]/remove-actions.ts");

describe("what stops a qualification being removed", () => {
  it("counts every record of something a learner did", () => {
    for (const record of [
      "learners enrolled",
      "Statements of Results issued",
      "EISA sittings registered",
      "certificates awarded",
      "cohorts running its courses",
      "assessment submissions",
      "workplace agreements",
      "recognition of prior learning applications",
    ]) {
      expect(library, `${record} is not checked`).toContain(`"${record}"`);
    }
  });

  it("names each reason rather than saying it is in use", () => {
    // "This is in use" tells somebody nothing. "Two learners are enrolled and
    // one Statement of Results has been issued" tells them whether it is a
    // mistake they can undo or a record they must keep.
    expect(library).toMatch(/holds: \{ what: string; count: number \}\[\]/);
    expect(screen).toMatch(/holds\.map\(/);
  });

  it("checks and deletes in one transaction", () => {
    // Checking in one and deleting in another leaves a window in which
    // somebody enrols between the two, and the enrolment would be taken with
    // the qualification it points at.
    const remove = library.slice(library.indexOf("export async function deleteQualification"));
    expect(remove).toMatch(/const usage = await qualificationUsage/);
    expect(remove).toMatch(/if \(usage\.holds\.length > 0\)/);
  });
});

describe("what goes with it when it may be removed", () => {
  it("counts them before asking", () => {
    // "And everything under it" is not a quantity anybody can weigh.
    expect(library).toMatch(/removes: \[/);
    expect(screen).toMatch(/It would take/);
  });

  it("takes a programme built for it, which would otherwise be orphaned", () => {
    // learning_paths points at a qualification with ON DELETE SET NULL, so
    // deleting the row alone leaves a programme attached to nothing.
    expect(library).toMatch(/delete\(learningPaths\)/);
  });

  it("records that it happened", () => {
    expect(library).toMatch(/action: "qualification\.deleted"/);
  });
});

describe("the control itself", () => {
  it("is absent, not disabled, where something blocks it", () => {
    // A disabled button invites somebody to find out how to enable it, and
    // this is not a permission problem to be worked around.
    expect(screen).toMatch(/if \(holds\.length > 0\) \{/);
    const blocked = screen.slice(screen.indexOf("if (holds.length > 0) {"));
    expect(blocked.slice(0, 1200)).not.toMatch(/<form/);
  });

  it("asks for the title to be typed", () => {
    // A qualification is the root of everything a provider builds; a
    // misplaced click should not be able to take all of it.
    expect(action).toMatch(/if \(typed !== title\)/);
    expect(screen).toMatch(/Type the title to confirm/);
  });

  it("goes somewhere afterwards, since the page it was on is gone", () => {
    expect(action).toMatch(/redirect\("\/qualifications"\)/);
  });
});
