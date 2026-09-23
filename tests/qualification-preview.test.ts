/**
 * Seeing a whole programme without sitting it.
 *
 * Job sheet 2.1. /papers/[id]/preview covers one paper; this covers the
 * qualification end to end, in the order a learner walks it.
 *
 * The reason it cannot reuse the learner's own screen is the thing worth
 * guarding. `/learn/[id]` is keyed on an enrolment, computes gating against a
 * named person, and records that steps were opened. An administrator looking
 * at their own programme through it would be enrolling on it and beginning to
 * sit it, which is precisely the complaint that produced the paper preview in
 * the first place.
 *
 * Source-reading, in the manner of tests/screen-patterns.test.ts: what matters
 * is that the preview writes nothing and that it is reachable, and both are
 * properties of how it is written rather than of one rendered page.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** The prose with the explanatory comments stripped out. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const library = source("lib/qualification-preview.ts");
const screen = source("app/qualifications/[id]/preview/page.tsx");

describe("a preview changes nothing", () => {
  it("never writes", () => {
    // The whole justification for a separate screen. Anything below turns it
    // back into sitting the programme.
    for (const forbidden of [".insert(", ".update(", ".delete("]) {
      expect(library, `${forbidden} in a preview`).not.toContain(forbidden);
    }
  });

  it("does not record that a step was opened", () => {
    expect(library).not.toMatch(/recordStepOpened|stepProgress/);
  });

  it("does not need an enrolment", () => {
    // Keyed on the qualification, so it works before anybody is enrolled,
    // which is when somebody is testing the programme. Checked against the
    // code rather than the comments, which discuss enrolment on purpose.
    expect(code("lib/qualification-preview.ts")).not.toMatch(
      /enrolments|getEnrolmentForDelivery/,
    );
    expect(library).toMatch(
      /previewQualification\(\s*session: AuthenticatedSession,\s*qualificationId: string,/,
    );
  });

  it("does not compute gating against a person", () => {
    // stepsForLearner answers "may this learner open it". A preview asks the
    // simpler question and must not pretend to answer the first.
    expect(code("lib/qualification-preview.ts")).not.toMatch(
      /stepsForLearner|assertStepOpen|blockedBy/,
    );
  });
});

describe("it is for the people who build programmes", () => {
  it("asks for course authoring, which is administrators and facilitators", () => {
    expect(library).toMatch(/assertSessionCan\(session, "course:author"\)/);
    expect(screen).toMatch(/requirePermission\("course:author"\)/);
  });
});

describe("it reports what a learner would not find", () => {
  it("names a study unit with nothing behind it", () => {
    expect(library).toMatch(/Nothing has been built for this study unit yet/);
  });

  it("names a course with no steps", () => {
    expect(library).toMatch(/no steps in it/);
  });

  it("names an assessment still in draft", () => {
    expect(library).toMatch(/still a draft, so a learner is not offered it/);
  });

  it("names a step whose target has gone", () => {
    expect(library).toMatch(/no longer there/);
  });

  it("counts what is ready against what exists", () => {
    // A total with no denominator says nothing. "12 of 40 ready" is the line
    // somebody testing a programme before a cohort actually acts on.
    expect(library).toMatch(/counts: \{ units: [^}]*steps: [^}]*ready: /);
    expect(screen).toMatch(/\{counts\.ready\} of \{counts\.steps\} ready/);
  });

  it("puts the gaps above the detail rather than below it", () => {
    const gaps = screen.indexOf("What a learner would not find");
    const units = screen.indexOf("preview.units.map");
    expect(gaps).toBeGreaterThan(-1);
    expect(units).toBeGreaterThan(-1);
    expect(gaps).toBeLessThan(units);
  });
});

describe("it can be reached", () => {
  /*
   * A tested library with no screen is a feature that does not exist, and a
   * screen with no link to it is the same thing one step later. This one is
   * linked from the Delivery structure section of the qualification, which is
   * where somebody is already looking at the study units it walks.
   */
  it("is linked from the qualification", () => {
    const page = source("app/qualifications/[id]/page.tsx");
    expect(page).toMatch(/\/qualifications\/\$\{id\}\/preview/);
    expect(page).toMatch(/See it as a learner will/);
  });

  it("offers the link only to somebody who may open it", () => {
    const page = source("app/qualifications/[id]/page.tsx");
    // The page is readable by assessors and moderators too, and a link that
    // refuses on arrival is worse than no link.
    expect(page).toMatch(/const canAuthorCourses = session\.permissions\.includes\("course:author"\)/);
    expect(page).toMatch(/canAuthorCourses \? \(/);
  });

  it("offers the way back to the qualification it came from", () => {
    expect(screen).toMatch(/href=\{`\/qualifications\/\$\{id\}`\}/);
  });

  it("hands an assessment step to the screen that already renders one", () => {
    expect(library).toMatch(/\/papers\/\$\{paperId\}\/preview/);
  });
});

describe("house style", () => {
  it("uses no em dashes in what the screen says", () => {
    // Heidi, 21 September: no em dashes in anything the platform produces.
    expect(screen).not.toMatch(/&mdash;|—/);
    expect(library).not.toMatch(/&mdash;|—/);
  });
});
