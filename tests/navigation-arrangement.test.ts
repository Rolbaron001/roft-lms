/**
 * What a stored menu arrangement does to a catalogue that has moved on.
 *
 * Roland, 15 September: "Templates is on the menu bar, but Management is no
 * longer there."
 *
 * He was reading it exactly right, and the cause was two defects meeting.
 * Curiosa's saved arrangement was written while the heading was still called
 * Admin. When it became Management, every page under it stayed behind in the
 * provider's own Admin heading, so the only thing that landed under Management
 * was Templates - the single page that was new. A heading with one item under
 * it then rendered as a bare link, so the heading vanished and Templates
 * appeared on the bar on its own.
 *
 * Both halves are tested here, with the arrangement as production actually
 * held it rather than an invented one.
 */
import { describe, expect, it } from "vitest";
import { NAV, arrangeNavigation, navigationCatalogue } from "@/lib/navigation";

/** Curiosa's stored arrangement on 15 September 2026, verbatim. */
const CURIOSA = [
  { items: ["/"], label: null },
  {
    items: ["/courses", "/paths", "/qualifications", "/capture"],
    label: "Learning",
  },
  {
    items: ["/people", "/cohorts", "/tracker", "/workplace", "/conduct"],
    label: "People",
  },
  {
    items: [
      "/assess",
      "/moderate",
      "/reassessments",
      "/appeals",
      "/recognition",
      "/eisa",
      "/readiness",
    ],
    label: "Assessment",
  },
  { items: ["/reports", "/statutory"], label: "Reports" },
  { items: ["/mail"], label: null },
  {
    items: [
      "/settings",
      "/imports",
      "/platform",
      "/records",
      "/dictionary",
      "/badges",
    ],
    label: "Admin",
  },
];

function headings(sections: { label: string | null }[]): (string | null)[] {
  return sections.map((section) => section.label);
}

describe("the catalogue itself", () => {
  /**
   * The defect underneath the reported one.
   *
   * A stored arrangement names pages by href, and `arrangeNavigation` keys
   * what it knows by href too. So the same page listed under two headings does
   * not appear twice - the second quietly overwrites the first, taking its
   * label and its permission with it. That is how "People" became "People &
   * roles" for everybody, and why the entry a learner relied on for the policy
   * library was answering to an administrator's permission.
   */
  it("lists every page exactly once", () => {
    const seen = new Map<string, string[]>();
    for (const section of NAV) {
      for (const item of section.items) {
        seen.set(item.href, [
          ...(seen.get(item.href) ?? []),
          `${section.label ?? "(no heading)"} → ${item.label}`,
        ]);
      }
    }

    const twice = [...seen.entries()].filter(([, where]) => where.length > 1);

    expect(
      twice.map(([href, where]) => `${href}: ${where.join(" and ")}`),
    ).toEqual([]);
  });

  it("keeps a Management section with something in it", () => {
    const management = NAV.find((section) => section.label === "Management");
    expect(management).toBeDefined();
    expect(management!.items.length).toBeGreaterThan(1);
  });

  /**
   * Both were in no menu at all: reachable only by already being on the screen
   * that links to them, which is not a way anybody finds a page.
   */
  it("carries the pages that had no menu entry", () => {
    const every = navigationCatalogue().map((item) => item.href);
    expect(every).toContain("/workplace/setup");
    expect(every).toContain("/reports/programme");
  });
});

describe("an arrangement saved before a heading was renamed", () => {
  it("keeps the pages with the heading rather than beside it", () => {
    const sections = arrangeNavigation(CURIOSA);

    // Admin is gone as a name, and nothing was stranded under it.
    expect(headings(sections)).not.toContain("Admin");

    const management = sections.find(
      (section) => section.label === "Management",
    );
    expect(management).toBeDefined();

    /*
     * By page, not by wording.
     *
     * This asserted the label "AI history", so renaming that page broke a test
     * about where pages live - two unrelated things tied together. A saved
     * arrangement stores hrefs and nothing else; the label always comes from
     * the current definition, which is precisely why a rename reaches a tenant
     * who saved their menu months ago.
     */
    const hrefs = management!.items.map((item) => item.href);
    // What their own arrangement had under Admin.
    expect(hrefs).toContain("/settings");
    expect(hrefs).toContain("/imports");
    expect(hrefs).toContain("/platform");
    // And what the platform has added to Management since they saved it.
    expect(hrefs).toContain("/templates");
  });

  it("names Management once, not twice", () => {
    const sections = arrangeNavigation(CURIOSA);
    const named = headings(sections).filter((label) => label === "Management");
    expect(named).toHaveLength(1);
  });

  /**
   * The reason the fold is done in code rather than by editing one tenant's
   * stored arrangement: an arrangement restored from a backup taken before the
   * rename has to be repaired too, and nobody would think to look.
   */
  it("merges an arrangement that names both the old and the new heading", () => {
    const both = [
      { items: ["/settings"], label: "Admin" },
      { items: ["/platform"], label: "Management" },
    ];

    const sections = arrangeNavigation(both);
    const named = headings(sections).filter((label) => label === "Management");
    expect(named).toHaveLength(1);

    const labels = sections
      .find((section) => section.label === "Management")!
      .items.map((item) => item.label);
    expect(labels).toContain("Settings");
    expect(labels).toContain("Clients");
  });

  it("still gives a provider the pages they never arranged", () => {
    const sections = arrangeNavigation(CURIOSA);
    const every = sections.flatMap((section) =>
      section.items.map((item) => item.href),
    );

    // Added after their arrangement was saved, under the heading each ships
    // with rather than dropped.
    expect(every).toContain("/fisa");
    expect(every).toContain("/enrolment-form");
    expect(every).toContain("/statutory/notify");
  });

  it("leaves an arrangement alone where nothing was renamed", () => {
    const sections = arrangeNavigation(CURIOSA);
    expect(headings(sections)).toContain("Learning");
    expect(headings(sections)).toContain("Assessment");

    const learning = sections.find((section) => section.label === "Learning")!;
    expect(learning.items.map((item) => item.href).slice(0, 4)).toEqual([
      "/courses",
      "/paths",
      "/qualifications",
      "/capture",
    ]);
  });
});
