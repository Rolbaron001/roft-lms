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
