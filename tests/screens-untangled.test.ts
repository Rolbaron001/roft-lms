/**
 * Two jobs on one screen, told apart.
 *
 * Roland, 19 September: "Can you also please separate the qualification detail
 * that is available from the upload process... This same sort of separation
 * would be good on the opening Qualifications page where currently there is a
 * mixture of building a new qualification whilst a list of available
 * qualifications is pushed in-between the creation and upload processes. Let's
 * untangle the screens please."
 *
 * He was describing both pages accurately. A qualification's own page showed
 * the curriculum below three upload cards and the document list below four, so
 * reading a curriculum meant scrolling past the machinery for building one.
 * The index put the list of qualifications between the folder uploads above it
 * and a dashed "new qualification" box below it.
 *
 * And in the same message: "there are no links on the buttons, so I can't view
 * the respective modules". The module chips inside each study unit looked
 * exactly like controls and did nothing at all.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const detail = source("app/qualifications/[id]/page.tsx");
const index = source("app/qualifications/page.tsx");
const tabs = source("components/view-tabs.tsx");

describe("the tab strip", () => {
  it("keeps the default tab on a plain URL", () => {
    // So the address somebody shares is the ordinary one, and the page has a
    // single canonical location rather than two that render the same thing.
    expect(tabs).toMatch(/index === 0 \? basePath :/);
  });

  it("is a link, so a tab survives a reload and can be linked to", () => {
    // Client state would lose the tab on every navigation and could not be
    // pointed at from a chip in the other view.
    expect(tabs).toMatch(/<Link/);
    expect(tabs).not.toMatch(/useState/);
  });
});

describe("a qualification's own page", () => {
  it("separates what it holds from what adds to it", () => {
    expect(detail).toMatch(/view === "build" \? \(/);
    expect(detail).toMatch(/label: "The qualification"/);
    expect(detail).toMatch(/label: "Add to it"/);
  });

  it("puts every upload control on the same side", () => {
    const build = detail.slice(
      detail.indexOf('view === "build" ? ('),
      detail.indexOf("      ) : (\n      <>"),
    );
    // The three ways in: finishing a curriculum, a folder of material, and a
    // single document. All of them belong together.
    expect(build).toMatch(/Finish this qualification from a fuller folder/);
    expect(build).toMatch(/A whole folder at once/);
    expect(build).toMatch(/Or one document/);
  });
});

describe("the module chips in a study unit", () => {
  it("go to the module rather than looking like buttons that do nothing", () => {
    expect(detail).toMatch(/href=\{`#module-\$\{entry\.code\}`\}/);
  });

  it("have somewhere to land", () => {
    expect(detail).toMatch(/id=\{`module-\$\{curriculumModule\.code\}`\}/);
    // And the heading clears the fixed header on arrival.
    expect(detail).toMatch(/id=\{`module-\$\{curriculumModule\.code\}`\}\s*\n\s*className="scroll-mt-24"/);
  });
});

describe("the qualifications index", () => {
  it("separates the list from the making of a new one", () => {
    expect(index).toMatch(/view === "add" \? \(/);
    expect(index).toMatch(/label: "Qualifications"/);
    expect(index).toMatch(/label: "Add a qualification"/);
  });

  it("shows the list one side and the create form the other", () => {
    expect(index).toMatch(/show="list"/);
    expect(index).toMatch(/show="create"/);
  });

  it("no longer tells somebody to build one 'above' on a tab that has none", () => {
    // The empty state pointed at upload controls that are now a tab away.
    const empty = index.slice(index.indexOf("No qualifications yet"));
    expect(empty.slice(0, 400)).not.toMatch(/documents above —/);
  });
});

/**
 * Finding a study unit's own material.
 *
 * Roland, 19 September: "How do I see the actual content of each Study Unit -
 * Where is the Theory Guide? How do I view it?"
 *
 * The documents were openable all along, but only from a table of eighty-one
 * rows at the bottom of the page with the unit code in a column. A study
 * unit's card listed its modules and nothing else, so the one place somebody
 * would look for SU1's theory guide was the one place it was not.
 */
describe("a study unit's material", () => {
  it("is listed on the unit itself, not only in the table below", () => {
    expect(detail).toMatch(/Material filed against this unit/);
    expect(detail).toMatch(/materialByUnit\.get\(unit\.code\)/);
  });

  it("opens", () => {
    const block = detail.slice(detail.indexOf("Material filed against this unit"));
    expect(block.slice(0, 900)).toMatch(
      /href=\{`\/api\/programme-documents\/\$\{document\.id\}`\}/,
    );
  });

  it("marks what a learner may not see", () => {
    // A label, not the lock: the download path enforces it, and the list
    // itself is already filtered by permission before it reaches the page.
    expect(detail).toMatch(/withheld from learners/);
    expect(detail).toMatch(/RESTRICTED_TO_ASSESSORS\.has\(/);
  });

  it("groups from what the page already loaded", () => {
    // A second query per study unit would be five queries for five units,
    // and the documents are already in hand.
    expect(detail).toMatch(/const materialByUnit = new Map/);
  });
});

/**
 * Three ways in, and only the one you picked.
 *
 * Roland, 20 September: "When adding a new qualification there are basically 3
 * options... Initially only display the 3 options with 'or' in-between,
 * selecting one will display its specific window to work from. That window can
 * be closed should the user decide against the selection and opt to see
 * another. This just makes the process clearer. You don't need to read a whole
 * page for something you're not going to use."
 *
 * Before this all three were open at once: a documents panel, a folder card, a
 * drive card and a dashed box holding a form of eight fields. Four hundred
 * words of explanation for three jobs, of which somebody is doing one.
 *
 * He suggested a modal and this is not one, deliberately. Two of the three are
 * work surfaces rather than dialogs - the folder route runs for minutes with a
 * progress counter, and the documents route is read, review, then commit. A
 * modal dismissed by a stray Escape or a backdrop click throws that away, and
 * a modal that refuses to be dismissed is not a modal. A panel chosen by the
 * URL closes to a link, survives a reload, and can be sent to somebody.
 */
describe("choosing how to add a qualification", () => {
  const chooser = source("app/qualifications/how-chooser.tsx");
  const page = source("app/qualifications/page.tsx");

  it("offers exactly the three ways Roland named", () => {
    for (const id of ["documents", "folder", "blank"]) {
      expect(chooser).toContain(`id: "${id}"`);
    }
    expect(chooser).toMatch(/From its documents/);
    expect(chooser).toMatch(/From a folder/);
    expect(chooser).toMatch(/From scratch/);
  });

  it("puts 'or' between them", () => {
    expect(chooser).toMatch(/>or</);
    // Between, not before the first.
    expect(chooser).toMatch(/index > 0 \?/);
  });

  it("says what each needs and what it costs", () => {
    // "From its documents" and "From a folder" are not told apart by name.
    expect(chooser).toMatch(/needs: string/);
    expect(chooser).toMatch(/speed: string/);
  });

  it("shows nothing but the choice until one is made", () => {
    expect(page).toMatch(/how === null \? \(\s*<HowChooser/);
  });

  it("opens one panel per choice, and only that one", () => {
    expect(page).toMatch(/how === "documents" \? \(/);
    expect(page).toMatch(/how === "folder" \? \(/);
    expect(page).toMatch(/how === "blank" \? \(/);
  });

  it("can be closed again to choose differently", () => {
    expect(page).toMatch(/<ChooseDifferently basePath="\/qualifications" \/>/);
    // The documents panel has its own Close, which must go back to the
    // chooser rather than collapsing to a button on an empty page.
    expect(page).toMatch(/closeHref="\/qualifications\?view=add"/);
  });

  it("ignores a way that does not exist rather than showing nothing", () => {
    // ?how=nonsense falls back to the chooser.
    expect(page).toMatch(/HOW_OPTIONS\.some\(\(option\) => option\.id === params\.how\)/);
  });
});
