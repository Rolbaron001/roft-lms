/**
 * The spine had every rule and no way in.
 *
 * lib/spine.ts could add a step, reorder one, remove one and gate one from the
 * first commit, and all of it was tested. `addStep` was called from nowhere
 * except the test files, so no screen in the platform could put a single thing
 * in front of a learner.
 *
 * Found on 23 September by the qualification preview: four assessments
 * captured into 121151, every one of them holding a draft paper and sitting on
 * no spine, so nothing a learner would ever meet. Roland, 24 September: build
 * the editor before anything else on the sheet.
 *
 * These tests hold the two things that made it a gap rather than a gap in the
 * library: the screen exists and is reachable, and it adds no rules of its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const reader = source("lib/spine-editor.ts");
const actions = source("app/courses/[id]/steps/actions.ts");
const screen = source("app/courses/[id]/steps/spine-editor.tsx");

describe("the spine can be reached", () => {
  it("has a screen", () => {
    expect(source("app/courses/[id]/steps/page.tsx")).toMatch(/courseSpine/);
  });

  it("is linked from the course", () => {
    const page = source("app/courses/[id]/page.tsx");
    expect(page).toMatch(/\/courses\/\$\{id\}\/steps/);
    expect(page).toMatch(/What a learner works through/);
  });

  it("is linked from the preview that found it missing", () => {
    // The preview names each gap. A gap with no way to close it is half a
    // screen, so every one of them ends in a route to here.
    const preview = source("app/qualifications/[id]/preview/page.tsx");
    expect(preview).toMatch(/\/courses\/\$\{unit\.courseId\}\/steps/);
    expect(preview).toMatch(/Build what a learner works through/);
  });

  it("offers a course to a study unit that has none", () => {
    /*
     * The second half of the same gap. Four of 121151's five study units had
     * no course at all, /courses/new cannot attach one to a study unit, and
     * the only thing that ever made one was capturing a document. So the
     * editor would have been unreachable for four units out of five.
     */
    const start = source("app/qualifications/[id]/preview/actions.ts");
    expect(start).toMatch(/courseForStudyUnit/);
    expect(start).toMatch(/redirect\(`\/courses\/\$\{courseId\}\/steps`\)/);
  });

  it("calls addStep from the application, not only from tests", () => {
    // The thing that was wrong. If this ever fails again, the editor has been
    // disconnected from the library that does the work.
    expect(actions).toMatch(/addStep\(session, \{/);
  });
});

describe("the screen adds no rules of its own", () => {
  it("leaves every refusal to the library", () => {
    // A gate that could never open, a prerequisite pointing forwards or round
    // in a circle, a step naming nothing: lib/spine.ts refuses all three, and
    // a second copy of that judgement here is a second copy to get wrong.
    for (const invented of [
      "cannot be summative",
      "circular",
      "already on the spine",
    ]) {
      expect(actions.toLowerCase()).not.toContain(invented);
    }
  });

  it("reorders by handing over the whole order", () => {
    // reorderSteps refuses anything that is not every step exactly once, which
    // is what stops a half-applied move. The action works out the new order
    // and lets the library check it.
    expect(actions).toMatch(/reorderSteps\(session, courseId, order\)/);
  });

  it("does not let a step wait for itself through the form", () => {
    expect(screen).toMatch(/filter\(\(other\) => other\.id !== step\.id\)/);
  });
});

describe("what it offers to add", () => {
  it("offers only what is held against this course", () => {
    expect(reader).toMatch(/eq\(assessments\.courseId, courseId\)/);
    expect(reader).toMatch(/eq\(courseSections\.courseId, courseId\)/);
  });

  it("does not offer something twice", () => {
    // Offering a workbook that is already a step reads as though adding it
    // the first time did not take.
    expect(reader).toMatch(/if \(taken\.has\(/);
  });

  it("offers work experience modules and not the other components", () => {
    // A knowledge module is taught and assessed. A work experience module is
    // proved by a logbook a coach signs, which is what a workplace step is.
    expect(reader).toMatch(/eq\(curriculumModules\.component, "workplace"\)/);
  });

  /*
   * Found by running the editor for the first time, on 24 September. Its
   * opening list of choices offered "CA 121151 SU1 WB1 AG", the answer guide
   * to a workbook, as something to put in front of a learner.
   */
  it("never offers a memorandum or a summative paper as a step", () => {
    const spine = source("lib/spine.ts");
    // Kept out of the list...
    expect(reader).toMatch(/RESTRICTED_TO_ASSESSORS\.has\(document\.kind as DocumentKind\)/);
    // ...and refused on the way in, because a filter on a list that a posted
    // identifier walks past is not a restriction.
    expect(spine).toMatch(/RESTRICTED_TO_ASSESSORS\.has\(document\.kind as DocumentKind\)/);
    expect(spine).toMatch(/kept from learners, so it cannot be a step/);
  });

  it("takes the restricted list from the one place that defines it", () => {
    // Two copies of "which documents are confidential" is two copies to drift.
    expect(reader).toMatch(/from "\.\/programme-documents"/);
    expect(source("lib/spine.ts")).toMatch(/from "\.\/programme-documents"/);
  });

  it("warns before adding something a learner could not use", () => {
    expect(reader).toMatch(/This is still a draft/);
    expect(reader).toMatch(/none of its papers are/);
  });

  it("still allows a draft to be added", () => {
    /*
     * Deliberate. Refusing would mean building the spine only once everything
     * on it is finished, and the shape of a programme is decided before its
     * last paper is proofread. The warning carries the news instead.
     */
    expect(actions).not.toMatch(/status !== "published"/);
  });
});

describe("what it reports about the spine it shows", () => {
  it("says where a step points at something gone", () => {
    expect(reader).toMatch(/no longer there/);
  });

  it("says where an assessment on the spine is still a draft", () => {
    expect(reader).toMatch(/still a draft, so a learner is not offered it/);
  });

  it("says what holds each step shut", () => {
    expect(screen).toMatch(/Waits for/);
    expect(screen).toMatch(/Open from the start/);
  });
});

describe("house style", () => {
  it("uses no em dashes", () => {
    for (const [name, text] of [
      ["reader", reader],
      ["actions", actions],
      ["screen", screen],
      ["page", source("app/courses/[id]/steps/page.tsx")],
    ] as const) {
      expect(text, `em dash in ${name}`).not.toMatch(/&mdash;|—/);
    }
  });
});
