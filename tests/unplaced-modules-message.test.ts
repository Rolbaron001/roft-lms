/**
 * What a qualification says about modules that sit in no study unit.
 *
 * A curriculum publishes modules and says nothing about study units, because
 * grouping them is the provider's own decision. So a qualification built from
 * its two base documents arrives with every module unplaced - and the first
 * thing somebody saw after a successful import was a red box announcing that
 * fifteen modules were taught by nobody.
 *
 * That reads as the import having failed when it did exactly what was asked.
 * Heidi's next attempt goes through that screen, and being told at the end of
 * it that nothing is taught is the last thing that should happen.
 *
 * The alarming version is right once some study units exist: a module left out
 * of a structure that is otherwise built is a real gap. Before that it is the
 * next step, and saying what that step is matters more than the colour.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(process.cwd(), "app/qualifications/[id]/page.tsx"),
  "utf8",
);

describe("modules in no study unit", () => {
  it("tells the two situations apart", () => {
    expect(page).toMatch(/studyUnits\.length === 0 \?/);
  });

  it("calls it the next step where nothing has been grouped yet", () => {
    expect(page).toContain("The next step: group these modules into study units.");
    expect(page).toMatch(/expected, not a fault in the import/);
  });

  it("names the document that does it", () => {
    // The alignment document builds the whole structure in one upload. Without
    // this the person is told there is a problem and left to find the cure.
    expect(page).toMatch(/alignment document/);
    expect(page).toMatch(/Word or\s+Excel/);
  });

  it("still raises the alarm once a structure exists", () => {
    expect(page).toMatch(/module no\s+study unit delivers is a module nobody teaches/);
    expect(page).toMatch(/borderColor: "var\(--danger\)"/);
  });
});
