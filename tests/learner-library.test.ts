/**
 * A learner must not see internal policies.
 *
 * Heidi, 21 September 2026: "A learner must not see internal policies.
 * Learners get a learner quality management guide instead."
 *
 * The library had one switch, `visibleToAll`, and nothing stopping it being
 * ticked on a facilitator's contract or the assessment policy. The audience is
 * now the category, and the rule is one pure function applied in three places:
 * what is stored, what is listed, and what the download route will hand over.
 *
 * Tested as a rule rather than through a screen, because the failure this
 * guards against is a fourth caller written later that checks `visibleToAll`
 * on its own and lets a contract through.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLearnerVisible,
  LEARNER_FACING,
  LIBRARY_CATEGORIES,
  mayBeLearnerVisible,
  visibilityFor,
} from "@/lib/records";

const INTERNAL = LIBRARY_CATEGORIES.filter(
  (category) => !LEARNER_FACING.has(category),
);

describe("what a learner may be shown", () => {
  it("never shows an internal category, whatever the switch says", () => {
    for (const category of INTERNAL) {
      expect(
        isLearnerVisible({ category, visibleToAll: true }),
        `${category} was shown to a learner`,
      ).toBe(false);
    }
  });

  it("names the categories that are internal, so a new one is a decision", () => {
    // If somebody adds a category and it silently becomes learner-facing,
    // this is the test that should have stopped them.
    expect([...INTERNAL].sort()).toEqual([
      "accreditation",
      "contract",
      "operational",
      "other",
      "policy",
    ]);
  });

  it("always shows a learner guide, because that is what the category means", () => {
    expect(isLearnerVisible({ category: "learner_guide", visibleToAll: false }))
      .toBe(true);
  });

  it("leaves statutory documents a real choice", () => {
    // The PAIA manual is meant to be available; a tenant still decides.
    expect(mayBeLearnerVisible("statutory")).toBe(true);
    expect(isLearnerVisible({ category: "statutory", visibleToAll: true })).toBe(
      true,
    );
    expect(isLearnerVisible({ category: "statutory", visibleToAll: false }))
      .toBe(false);
  });

  it("treats an unknown category as internal", () => {
    expect(isLearnerVisible({ category: "nonsense", visibleToAll: true })).toBe(
      false,
    );
  });
});

describe("what gets stored", () => {
  it("does not keep a tick the reader would overrule", () => {
    // A row saying visible_to_all on a contract is a lie in the database,
    // even where the read path refuses to act on it.
    for (const category of INTERNAL) {
      expect(visibilityFor(category, true), category).toBe(false);
    }
  });

  it("does not make a learner guide depend on remembering a checkbox", () => {
    expect(visibilityFor("learner_guide", false)).toBe(true);
  });

  it("stores what the reader will act on, for every category", () => {
    // The column and the rule must never disagree. Where they can, the screen
    // shows one thing ("everybody can read this") and the platform does
    // another, and nobody can tell which by looking.
    for (const category of LIBRARY_CATEGORIES) {
      for (const asked of [true, false]) {
        const stored = visibilityFor(category, asked);
        expect(
          isLearnerVisible({ category, visibleToAll: stored }),
          `${category}, asked ${asked}, stored ${stored}`,
        ).toBe(stored);
      }
    }
  });
});

describe("the rule is applied everywhere it has to be", () => {
  function source(path: string): string {
    return readFileSync(join(process.cwd(), path), "utf8");
  }

  it("filters the listing by the rule, not by the column", () => {
    const records = source("lib/records.ts");
    expect(records).toMatch(/\.filter\(\(row\) => mayReadAll \|\| isLearnerVisible\(row\)\)/);
  });

  it("guards the download with the same rule", () => {
    // A filter on a list that a URL walks straight past is not a restriction.
    const records = source("lib/records.ts");
    expect(records).toMatch(/readLibraryDocument/);
    expect(records).toMatch(/mayReadAll \|\| isLearnerVisible\(row\)/);
  });

  it("has a route for the download to exist at all", () => {
    const route = source("app/api/library/[id]/route.ts");
    expect(route).toMatch(/readLibraryDocument/);
    // Never rendered in the application's own origin.
    expect(route).toMatch(/attachment; filename=/);
    expect(route).toMatch(/nosniff/);
  });

  it("offers the category on the filing form", () => {
    expect(source("app/records/forms.tsx")).toMatch(
      /learner_guide: "Learner guides"/,
    );
  });

  it("carries the value into the database before the schema is pushed", () => {
    const pre = source("scripts/pre-migrate.ts");
    expect(pre).toMatch(/library_category/);
    expect(pre).toMatch(/learner_guide/);
  });
});
