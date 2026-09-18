/**
 * The qualifications screen with nothing on it.
 *
 * Found on 18 September by signing in as a facilitator and looking. Every
 * other list on the platform says what would be here when it holds nothing -
 * "Nothing is waiting", "No cohorts yet", "Nothing open" - and this one said
 * nothing at all. A facilitator or an assessor opening it before any
 * qualification had been loaded got a heading, a paragraph explaining what a
 * qualification is, and then the bottom of the page. They see no import
 * controls either, correctly, so the screen was blank.
 *
 * It could not be seen by the person who built it: an administrator has the
 * import cards above the list, so for them the page is never empty.
 *
 * The two readers need different sentences, because they can do different
 * things about it, and that is what this holds on to. Telling a facilitator to
 * build one from its documents would send them to a control they are rightly
 * refused.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(process.cwd(), "app/qualifications/page.tsx"),
  "utf8",
);

describe("an empty qualifications screen", () => {
  it("says something when there is nothing to list", () => {
    expect(page).toContain("<EmptyState");
    expect(page).toMatch(/withModules\.length === 0/);
  });

  it("says a different thing to somebody who cannot load one", () => {
    // Both branches present. One sentence for both would either point a
    // facilitator at a control they may not use, or leave an administrator
    // without the next step.
    const block = page.slice(page.indexOf("<EmptyState"));
    expect(block).toMatch(/canManage \?/);
    expect(block).toMatch(/administrator/i);
  });

  it("keeps the list itself for when there is one", () => {
    // The empty state sits beside the list rather than replacing it: an
    // administrator with no qualifications still needs the create controls
    // the manager carries.
    expect(page).toContain("<QualificationsManager");
  });
});
