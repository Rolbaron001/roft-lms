/**
 * What to do next, on a page that is already full.
 *
 * Roland, 19 September, having just created a qualification on production:
 * "After clicking Create there is nothing to guide you to the next step. The
 * page is full, but I can't see what to do next."
 *
 * There had been a panel here and it did not do the job, in three separate
 * ways. It was shown only when the URL carried ?just=created, so it vanished
 * on the first reload - which is exactly when somebody comes back to finish.
 * It was prose rather than a list, so there was nothing to scan. And it said
 * "further down this page" without a link, on a page that runs to fifteen
 * modules and several hundred curriculum lines.
 *
 * What replaced it is read from the qualification itself, so it says the same
 * thing on arrival and on a return visit next week, and each outstanding step
 * links to the control that does it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(process.cwd(), "app/qualifications/[id]/page.tsx"),
  "utf8",
);

describe("the next-steps panel", () => {
  it("is built from the qualification, not from the URL", () => {
    // The whole failure was a panel that existed only immediately after
    // creation. Nothing here may depend on a query parameter again.
    expect(page).not.toMatch(/justCreated/);
    expect(page).toMatch(/const steps = \[/);
  });

  it("covers the three things that have to happen", () => {
    expect(page).toContain('title: "The curriculum"');
    expect(page).toContain('title: "Study units"');
    expect(page).toContain('title: "The material"');
  });

  it("decides each one from data rather than a flag", () => {
    expect(page).toMatch(/done: modules\.length > 0/);
    expect(page).toMatch(/done: studyUnitsPlaced/);
    expect(page).toMatch(/done: documents\.length > 0/);
  });

  /**
   * A module in no study unit is not a finished structure, even where study
   * units exist. The alignment document creates the units and places the
   * modules in one act, so the half-done state is rare - and worth catching
   * when it happens rather than being reported as complete.
   */
  it("does not call the structure done while a module sits outside it", () => {
    expect(page).toMatch(
      /studyUnits\.length > 0 && unplacedModules\.length === 0/,
    );
  });

  it("links each outstanding step to the control that does it", () => {
    for (const anchor of ["#curriculum", "#documents", "#material"]) {
      expect(page).toContain(`href: "${anchor}"`);
      // And the destination exists on this page.
      expect(page).toContain(`id="${anchor.slice(1)}"`);
    }
  });

  it("leaves room for the header when jumping", () => {
    // Without this the heading lands under the fixed bar and somebody arrives
    // looking at the middle of the section they asked for.
    const anchored = page.match(/id="(curriculum|documents|material|structure)"/g) ?? [];
    const withRoom = page.match(/scroll-mt-24/g) ?? [];
    expect(withRoom.length).toBeGreaterThanOrEqual(anchored.length);
  });

  it("disappears when there is nothing left to do", () => {
    // A checklist with nothing on it is clutter, and this page has enough.
    expect(page).toMatch(/modules\.length === 0 \|\| needed\.length > 0/);
  });

  it("is shown only to somebody who can act on it", () => {
    expect(page).toMatch(/canManage && \(modules\.length === 0/);
  });
});
