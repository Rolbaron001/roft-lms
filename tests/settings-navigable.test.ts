/**
 * Everything on the Settings page is named at the top of it.
 *
 * Roland, 18 September: "Please create a menu bar under Settings. It is very
 * difficult to navigate there especially if you don't know all the options
 * that can be found there."
 *
 * The second half is the real complaint. Eight sections stacked vertically,
 * each only discoverable by scrolling past the ones above — so somebody
 * looking for the mail test has to already know it sits below terminology, and
 * somebody who does not know the platform can set a clock never finds out it
 * can.
 *
 * The list itself is built from the rendered page rather than from a second
 * list kept beside it, so it cannot fall out of step. What it cannot do is
 * notice a section that was never marked — and that is exactly how this
 * complaint comes back: somebody adds a card at the bottom, does not mark it,
 * and it is invisible again for everybody who does not already know it is
 * there.
 *
 * So this reads the page and fails if a card sits outside a marked section.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);

/** Each marked section, in the order the page renders them. */
function marked(): string[] {
  return Array.from(page.matchAll(/data-settings-section="([^"]+)"/g)).map(
    (match) => match[1],
  );
}

describe("the Settings page", () => {
  it("marks every section it renders", () => {
    // A card is a section on this page. One outside a marked block would not
    // appear in the list, which is the fault this guards.
    const cards = Array.from(page.matchAll(/<Card\b/g)).length;
    const forms = ["<BrandingForm", "<ClockForm"].filter((one) =>
      page.includes(one),
    ).length;

    expect(marked().length).toBe(cards + forms);
  });

  it("names them in words somebody would look for", () => {
    const names = marked();

    // Not "branding-form" or "section-3": what the thing is called on screen.
    expect(names).toContain("Outbound mail");
    expect(names).toContain("What you call things");
    expect(names).toContain("AI extension");
    expect(names).toContain("File stores");
  });

  it("gives each one an anchor to jump to", () => {
    /*
     * Whitespace is flattened first. One section is written on a single line
     * and the rest across several, and whether an anchor exists has nothing to
     * do with how the attributes were wrapped - a test that fails on
     * formatting teaches people to reformat rather than to fix.
     */
    const flat = page.replace(/\s+/g, " ");
    const anchored = Array.from(
      flat.matchAll(/id="[a-z-]+" data-settings-section="/g),
    );

    expect(anchored.length).toBe(marked().length);
  });

  /**
   * Without this the heading lands under the fixed bar and the person arrives
   * looking at the middle of the section they asked for.
   */
  it("leaves room for the header when jumping", () => {
    const jumped = Array.from(page.matchAll(/data-settings-section="[^"]+"/g));
    const withRoom = Array.from(page.matchAll(/scroll-mt-24/g));

    expect(withRoom.length).toBe(jumped.length);
  });
});
