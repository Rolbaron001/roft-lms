/**
 * Saying the right thing about an extension somebody does not have.
 *
 * Found on 18 September by loading the real 121151 into a local tenant and
 * opening the qualification screen, which is the only way it shows: the
 * account has to have no extension set up, and everybody developing this has
 * one.
 *
 * The note under the folder picker asked two questions of one flag. Somebody
 * with no extension at all has no provider, so nothing can report whether it
 * runs here - `availability` is null, `available` falls back to false, and the
 * screen said "Your AI extension cannot run here", followed by the empty space
 * where the reason would have gone. Both halves wrong: they have no extension,
 * and nothing is stopping them setting one up.
 *
 * It is the same fault the top of this card was fixed for on 16 September,
 * surviving in the branch that shows when a qualification is already named -
 * which is exactly the screen somebody uses to finish a part-loaded import.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const picker = readFileSync(
  join(process.cwd(), "components/folder-picker.tsx"),
  "utf8",
);

/** Every screen that hands this component an extension has to pass all of it. */
const CALLERS = [
  "app/qualifications/page.tsx",
  "app/qualifications/[id]/page.tsx",
  "app/courses/[id]/page.tsx",
  "app/paths/[id]/page.tsx",
];

describe("what the folder picker says about an extension", () => {
  it("separates having one from its being able to run", () => {
    expect(picker).toMatch(/registered: boolean;/);
    expect(picker).toContain("You do not have an AI extension set up.");
  });

  it("asks whether they have one before asking whether it runs", () => {
    // The order is the fix. Reversed, somebody with none falls into the
    // "cannot run" branch again and is told about a reason that does not
    // exist.
    const notSetUp = picker.indexOf("!extension.registered");
    const cannotRun = picker.indexOf("!extension.available ?");
    expect(notSetUp).toBeGreaterThan(-1);
    expect(cannotRun).toBeGreaterThan(notSetUp);
  });

  it("is told the truth by every screen that shows it", () => {
    for (const caller of CALLERS) {
      const source = readFileSync(join(process.cwd(), caller), "utf8");
      expect(source).toMatch(/registered: extension\.registered/);
    }
  });
});
