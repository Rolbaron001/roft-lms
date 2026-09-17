/**
 * A drive is offered wherever a folder is.
 *
 * Roland, 17 September: "all the functionality in terms of uploads need to
 * exist for Part Qualifications, Learnership Programmes, Programmes, Courses,
 * etc. Google Drive and One Drive will always be available to upload from."
 *
 * That is a rule about every screen rather than about one, and the way it
 * breaks is by omission: somebody adds a new place to upload a folder, does
 * not think about drives, and a provider who keeps everything on Google Drive
 * finds that one screen in five still makes them download it first. Nothing
 * fails; it is just worse in one place than another, which is the hardest kind
 * of inconsistency to notice.
 *
 * So this reads the screens rather than trusting that they were all changed.
 * A screen that offers a folder picker and no drive picker fails here, and the
 * failure names the file.
 *
 * Part qualifications need no separate screen: a part is a qualification with
 * a parent, and it is viewed and filled through the same qualification screens
 * as a full one. If that ever stops being true this test will not notice, so
 * it is said here rather than assumed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Every page under app/, walked the way the reachability test walks it. */
function pages(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      found.push(...pages(full));
    } else if (entry === "page.tsx") {
      found.push(full);
    }
  }

  return found;
}

/** Every screen that lets somebody upload a folder. */
function screensOfferingAFolder(): string[] {
  return pages("app").filter((path) => read(path).includes("<FolderPicker"));
}

describe("every screen that takes a folder", () => {
  it("is a list that has not silently emptied", () => {
    // If this drops to nothing, the check below passes for the wrong reason.
    expect(screensOfferingAFolder().length).toBeGreaterThanOrEqual(4);
  });

  it("also offers a connected drive", () => {
    const missing = screensOfferingAFolder().filter(
      (path) => !read(path).includes("<DrivePicker"),
    );

    expect(missing).toEqual([]);
  });

  /**
   * The four things a provider uploads material against. Named so that losing
   * one is a failure rather than a smaller list quietly passing.
   */
  it("covers qualifications, courses and programmes", () => {
    const screens = screensOfferingAFolder().join(" ");

    expect(screens).toContain("app/qualifications/page.tsx");
    expect(screens).toContain("app/qualifications/[id]/page.tsx");
    expect(screens).toContain("app/courses/[id]/page.tsx");
    expect(screens).toContain("app/paths/[id]/page.tsx");
  });
});

describe("what a drive is asked to do", () => {
  /**
   * The same four targets the uploaded-folder route understands. A drive that
   * could only build a new qualification would be half a feature: Curiosa's
   * material is filed against courses and programmes too.
   */
  it("understands every target the uploaded route does", () => {
    const actions = read("app/imports/drive-actions.ts");

    expect(actions).toContain("qualificationId");
    expect(actions).toContain("courseId");
    expect(actions).toContain("learningPathId");
    // And topping up a part-loaded qualification, which is its own mode.
    expect(actions).toContain("top_up");
  });

  it("ends at a proposal, not at a write", () => {
    const actions = read("app/imports/drive-actions.ts");

    // The same check an uploaded folder gets. Arriving by a different road is
    // no reason to skip it.
    expect(actions).toContain("proposed");
    expect(actions).toContain("Check what it found before committing");
  });
});
