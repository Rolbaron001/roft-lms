/**
 * Where you are in the process, and what to press next.
 *
 * Roland asked twice on 19 September, because the first answer missed the
 * point. What he had been given was prose: "Upload your alignment document ...
 * under the documents below. You can also build them by hand here." Three
 * pointers - below, under, here - and not one of them a link, on a page
 * running to fifteen modules and five hundred curriculum lines. One of the
 * three pointed at a screen that does not exist at all.
 *
 * His words: "The screen doesn't show where you are in the process, neither
 * does it guide you through the steps. Please add a progress map, add a finger
 * or a mascot to point where to go and what to do next."
 *
 * Two separate things, and they answer different questions. The map answers
 * "how far have I got" - so it shows the finished steps too, which a list of
 * what is outstanding cannot. The pointer answers "what do I press" - so it
 * sits beside the control, not in a sentence describing where the control
 * might be.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const page = readFileSync(
  join(root, "app/qualifications/[id]/page.tsx"),
  "utf8",
);
const map = readFileSync(join(root, "components/progress-map.tsx"), "utf8");

/**
 * The page with its comments removed.
 *
 * The comments explaining this change quote the wording it removed, so a test
 * reading the whole file cannot tell the copy from the note about the copy -
 * and would teach the next person to delete the explanation rather than keep
 * the promise.
 */
const rendered = page
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("the progress map", () => {
  it("is built from the qualification, not from the URL", () => {
    // The first version appeared only with ?just=created, so it vanished on
    // the first reload - which is when somebody comes back to finish.
    expect(page).not.toMatch(/justCreated/);
    expect(page).toMatch(/const steps = \[/);
  });

  it("shows every step, including the ones behind you", () => {
    // This is what makes it a map rather than a to-do list. Hiding finished
    // steps hides the answer to "how far have I got".
    expect(map).toMatch(/steps\.map\(/);
    expect(map).toMatch(/\{done\} of \{steps\.length\} done/);
    expect(map).toMatch(/You are here/);
  });

  it("decides each step from data rather than a flag", () => {
    expect(page).toMatch(/done: modules\.length > 0/);
    expect(page).toMatch(/done: studyUnitsPlaced/);
    expect(page).toMatch(/done: teachingMaterial\.length > 0/);
  });

  /**
   * The qualification's own source documents are not teaching material.
   *
   * Building a qualification from its documents files three of them, so
   * counting every document marked the last step done before anybody had
   * uploaded a workbook - which is exactly the false reassurance this map
   * exists to replace.
   */
  it("does not count the source documents as material", () => {
    expect(page).toMatch(/SOURCE_KINDS/);
    for (const kind of [
      "qualification_document",
      "curriculum_document",
      "assessment_specification",
    ]) {
      expect(page).toContain(`"${kind}"`);
    }
  });

  it("does not call the structure done while a module sits outside it", () => {
    expect(page).toMatch(
      /studyUnits\.length > 0 && unplacedModules\.length === 0/,
    );
  });

  it("stops telling you what is next once nothing is", () => {
    // The map stays - it is a map. The instruction goes.
    expect(map).toMatch(/const next = steps\.find\(\(step\) => !step\.done\) \?\? null;/);
    expect(map).toMatch(/\{next \? \(/);
  });
});

describe("the pointer", () => {
  it("sits beside the control rather than describing where it is", () => {
    expect(page).toMatch(/<PointHere>/);
    // Both outstanding steps have one: the alignment document, and the folder.
    expect((page.match(/<PointHere>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("is shown only for the step somebody is on", () => {
    expect(page).toMatch(/!studyUnitsPlaced && modules\.length > 0 \?/);
    expect(page).toMatch(/studyUnitsPlaced && teachingMaterial\.length === 0 \?/);
  });

  it("uses the tenant's own mascot, or nothing", () => {
    // Curiosa's character must not appear in another provider's product.
    expect(map).toMatch(/AttentionMascot/);
    expect(map).not.toMatch(/curiosa/i);
  });
});

describe("what the page no longer says", () => {
  it("has no pointer that is not a link", () => {
    // "under the documents below" and "build them by hand here" - the second
    // of which named a screen that has never existed.
    expect(rendered).not.toMatch(/under the documents below/);
    expect(rendered).not.toMatch(/build them by hand here/);
  });

  it("sends every step to a destination that exists", () => {
    for (const anchor of ["#curriculum", "#documents", "#material"]) {
      expect(page).toContain(`href: "${anchor}"`);
      expect(page).toContain(`id="${anchor.slice(1)}"`);
    }
  });
});
