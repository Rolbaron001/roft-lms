/**
 * The fixes of 19-21 September, held in place across the screens they were
 * applied to.
 *
 * Roland, 19 September: "The fixes that you made so far today must be applied
 * throughout the LMS, to Programmes, Courses, Half Qualifications, etc."
 *
 * Each of these came from him watching a real screen fail him, and each is the
 * sort of thing that is fixed once and reappears on the next screen somebody
 * writes. A test per pattern is worth more than a test per page: it says what
 * the rule is, so a new screen either follows it or fails here.
 *
 * Source-reading rather than rendering, in the manner of
 * tests/model-names-move.test.ts. These are conventions about how a page is
 * written, and the thing worth guarding is that the convention was followed -
 * a rendered assertion would pass on a page that happened to look right today
 * and say nothing about why.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** The prose, with the explanatory comments stripped out. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("a screen doing two jobs separates them", () => {
  /*
   * "A list of available qualifications is pushed in-between the creation and
   * upload processes. Let's untangle the screens please." - 19 September.
   *
   * The same shape was on Programmes, in the other order: a list, then a form
   * for making another underneath it. Neither job had a screen of its own.
   */
  it.each([
    ["app/qualifications/page.tsx", "Qualifications"],
    ["app/paths/page.tsx", "Programmes"],
  ])("%s (%s) uses tabs rather than stacking them", (path) => {
    const page = code(path);
    expect(page).toMatch(/<ViewTabs/);
    expect(page).toMatch(/searchParams/);
  });
});

describe("an empty screen says what to do, with something to press", () => {
  /*
   * "Create one below" and "Create one to get started" are directions with
   * nothing to follow. Every one of these screens can be reached by somebody
   * who cannot create anything at all, so the message has to differ by what
   * the reader may do - which is why EmptyState rather than a bare card.
   */
  it.each([
    "app/qualifications/page.tsx",
    "app/paths/page.tsx",
    "app/courses/page.tsx",
  ])("%s uses EmptyState", (path) => {
    expect(code(path)).toMatch(/<EmptyState/);
  });

  it("does not leave the old 'below' directions behind", () => {
    // "Below" is not a direction on a page that scrolls, and both of these
    // outlived the layout that made them true.
    expect(code("app/paths/page.tsx")).not.toMatch(/Create one below/);
    expect(code("app/courses/page.tsx")).not.toMatch(/Create one to get started/);
  });
});

describe("a result that finishes a job offers the way out of it", () => {
  /*
   * "There is no clear navigation after the upload message. The display still
   * looks like I should be doing something else on the page." - 21 September.
   *
   * Both of these are forms somebody finishes: the document uploader, and the
   * tick list of modules a part qualification takes. Each reported success and
   * left the reader standing in the form.
   */
  it("the document uploader links onward", () => {
    const uploader = code(
      "app/qualifications/[id]/documents/document-uploader.tsx",
    );
    expect(uploader).toMatch(/state\.links/);

    const actions = code("app/qualifications/[id]/documents/actions.ts");
    // And where nothing matched, onward means the problem rather than the top
    // of the page.
    expect(actions).toMatch(/#curriculum/);
  });

  it("the part qualification module selection links onward", () => {
    const selection = code("app/qualifications/[id]/modules/module-selection.tsx");
    expect(selection).toMatch(/state\.notice/);
    expect(selection).toMatch(/Back to the qualification/);
  });
});

describe("a long page keeps its own navigation in view", () => {
  /*
   * "A floating navigation bar or sub-menu would work better for such long
   * pages." - 19 September. The qualification page runs to fifteen modules,
   * five hundred curriculum lines and eighty documents.
   */
  it("is one component, not one per page", () => {
    // Settings had its own scroll-tracking copy first. Two copies of a list
    // built from the page's own sections drift the first time either is
    // touched, and the way they drift is a section that stops being listed -
    // which is the complaint that produced the first one.
    const settingsNav = code("app/settings/settings-nav.tsx");
    expect(settingsNav).toMatch(/PageNav/);
    expect(settingsNav).not.toMatch(/addEventListener/);
  });

  it("sticks rather than scrolling away", () => {
    // A list at the top answers "what is on this page" once, on arrival. A
    // long page needs it answered again where somebody gets lost, which is
    // never at the top.
    expect(code("components/page-nav.tsx")).toMatch(/sticky/);
  });

  it("is built from what the page rendered", () => {
    const nav = code("components/page-nav.tsx");
    expect(nav).toMatch(/querySelectorAll/);

    // And the qualification page marks its sections, or the nav has nothing
    // to list and silently renders nothing at all.
    const page = source("app/qualifications/[id]/page.tsx");
    expect(page).toMatch(/<PageNav/);
    expect(page.match(/data-page-section=/g) ?? []).toHaveLength(3);
  });
});

/**
 * Every section of Settings names itself in the list at the top.
 *
 * Roland, 18 September: Settings was "very difficult to navigate especially if
 * you don't know all the options that can be found there." The answer was a
 * list built from the page's own sections, so a section added later names
 * itself rather than waiting for somebody to update a second list.
 *
 * Roland, 22 September: "'How filenames are read' under Settings is an
 * important part of how the LMS works. It needs to be added to the Settings
 * menu bar please."
 *
 * It was the one section carrying no marker. The list built itself from every
 * other section and left that one out silently, which is the exact fault the
 * list exists to prevent, and it was hiding the setting that decides whether
 * an upload arrives filled in or blank.
 *
 * So this checks the rule rather than the instance: every form the Settings
 * page renders is either wrapped in a marked container there, or marks itself.
 */
describe("the Settings list leaves nothing out", () => {
  const page = source("app/settings/page.tsx");

  /** The form components Settings renders, from its own imports. */
  const components = [...page.matchAll(/import \{ (\w+) \} from "\.\/([\w-]+)"/g)]
    .map((match) => ({ name: match[1], file: `app/settings/${match[2]}.tsx` }))
    // SettingsNav is the list itself, so it is not a section in it.
    .filter((one) => one.name !== "SettingsNav");

  it("finds the forms to check", () => {
    // A guard on the test rather than on the code: if the import shape
    // changes, this notices rather than passing vacuously on an empty list.
    expect(components.length).toBeGreaterThan(5);
  });

  it.each(components.map((one) => [one.name, one.file]))(
    "%s is named in the list",
    (name, file) => {
      const rendered = new RegExp(`<${name}\b`);
      if (!rendered.test(page)) return; // imported but not rendered

      const wrappedOnThePage = new RegExp(
        `data-settings-section=[\s\S]{0,400}?<${name}\b`,
      ).test(page);

      const marksItself = source(file).includes("data-settings-section");

      expect(
        wrappedOnThePage || marksItself,
        `${name} renders a Settings section that the list cannot see`,
      ).toBe(true);
    },
  );

  it("names the filename rules, which were the ones missing", () => {
    expect(source("app/settings/naming-form.tsx")).toMatch(
      /data-settings-section="How filenames are read"/,
    );
  });
});
