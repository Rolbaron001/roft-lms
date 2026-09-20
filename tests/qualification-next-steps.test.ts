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
   * Teaching material is named, not inferred.
   *
   * This was an exclusion list - everything that is not one of the three
   * source documents - and it survived an hour. Uploading the alignment
   * matrix, which is structure rather than teaching, marked the material step
   * complete on one spreadsheet: "3 of 3 done" after a single file, which
   * Roland rightly said could not be true.
   */
  it("counts only what is taught from", () => {
    expect(page).toMatch(/TEACHING_KINDS\.has/);
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

  /**
   * Every step goes to the tab its control is actually on.
   *
   * Splitting this page into tabs broke both outstanding steps, and neither
   * failed loudly. "#documents" became the document list on the other tab - a
   * real anchor, with no uploader under it - so the button scrolled somewhere
   * useless. "#material" did not exist on the default tab at all, so that one
   * did nothing whatever. A link within a page stops working the moment the
   * page becomes two.
   */
  it("sends every step to a destination that exists, on the right tab", () => {
    // The curriculum is on the default tab, so a bare anchor is correct.
    expect(page).toContain('href: "#curriculum"');
    expect(page).toContain('id="curriculum"');

    // The two upload controls live on the build tab, so these must cross.
    expect(page).toContain('?view=build#add-document');
    expect(page).toContain('?view=build#material');
    expect(page).toContain('id="add-document"');
    expect(page).toContain('id="material"');
  });

  it("does not point at an anchor on a tab it is not on", () => {
    // The bare "#documents" and "#material" of the one-page version.
    expect(page).not.toContain('href: "#documents"');
    expect(page).not.toContain('href: "#material"');
  });
});

/**
 * Which documents mean a qualification can be taught.
 *
 * Asserted against the real list rather than against the page, because this is
 * the judgement the map rests on: get it wrong and the platform tells somebody
 * their qualification is ready when nobody could teach from it.
 */
describe("what counts as teaching material", () => {
  it("excludes the documents a qualification is built out of", async () => {
    const { TEACHING_KINDS } = await import("@/lib/programme-documents");

    for (const kind of [
      "qualification_document",
      "curriculum_document",
      "assessment_specification",
      // Structure, not teaching. This is the one that got through.
      "alignment_matrix",
      "rollout_schedule",
      "learning_roadmap",
      "workplace_agreement",
      "other",
    ] as const) {
      expect(TEACHING_KINDS.has(kind), `${kind} counted as material`).toBe(
        false,
      );
    }
  });

  it("includes what a learner or facilitator actually works from", async () => {
    const { TEACHING_KINDS } = await import("@/lib/programme-documents");

    for (const kind of [
      "theory_guide",
      "workbook",
      "workbook_memorandum",
      "summative_assessment",
      "summative_memorandum",
      "learner_handbook",
      "workplace_signoff",
    ] as const) {
      expect(TEACHING_KINDS.has(kind), `${kind} not counted as material`).toBe(
        true,
      );
    }
  });
});
