/**
 * The character beside the button, and whose character it is.
 *
 * Heidi asked for one of Curiosa's characters next to the button somebody has
 * to press next, and she was right about the problem - she chose a folder on
 * 16 September and did not notice that the next step had appeared. An arrow
 * and a ring were not enough.
 *
 * What cannot follow is a Curiosa graphic in a shared component. The same
 * components are what every other tenant sees, and the standing rule is that
 * nothing is built for one of them alone. So the picture is whatever that
 * tenant set in Settings, and a tenant who set none gets the words and the
 * arrow exactly as before.
 *
 * Two things are worth failing a build over. That no tenant's filename is ever
 * written into a component - which is the easy mistake, made quickly, in a
 * hurry, by somebody being helpful. And that every route which takes a folder
 * has the prompt at all: there are three today and the drive one did not have
 * it, which is how the fourth would arrive without it too.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/** Every screen that offers a folder and then asks somebody to press a button. */
const ROUTES = [
  "components/folder-picker.tsx",
  "components/drive-picker.tsx",
  "app/qualifications/from-document.tsx",
];

describe("the attention prompt", () => {
  it("appears on every route that takes a folder", () => {
    for (const path of ROUTES) {
      expect(source(path)).toContain("<AttentionMascot");
    }
  });

  it("says in words what the picture says", () => {
    // The picture is decorative and hidden from a screen reader. If the
    // sentence beside it ever goes, somebody using one is told nothing at all.
    for (const path of ROUTES) {
      expect(source(path)).toMatch(/Now press this/);
    }
  });

  it("is decorative, so a screen reader is not told about it twice", () => {
    const component = source("components/tenant-illustration.tsx");
    expect(component).toContain('alt=""');
    expect(component).toContain("aria-hidden");
  });

  /**
   * The rule this whole arrangement exists to keep.
   *
   * A tenant's own graphic named in a component would appear in every other
   * tenant's product. The picture has to arrive from the database.
   */
  it("names no tenant's own graphic anywhere in the interface", () => {
    /*
     * `git grep -l` exits 1 when it finds nothing, which is the passing case
     * here, so the throw is caught and read as "clean" rather than left to
     * fail the test for the very outcome it is looking for.
     */
    let named = "";
    try {
      named = execFileSync(
        "git",
        [
          "grep",
          "-lEi",
          "curiosa[^\"']*\\.(png|jpe?g|svg|webp)|/(mascot|characters)/",
          "--",
          "app",
          "components",
        ],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
    } catch {
      named = "";
    }

    expect(named).toBe("");
  });

  it("renders nothing where the tenant has set none", () => {
    // Not a prop with a default. A component that falls back to a picture is
    // one deployment's picture in another deployment's product.
    const component = source("components/tenant-illustration.tsx");
    expect(component).toMatch(/if \(!url\) return null;/);
  });

  /** The frame says it once, so a screen added later does not have to. */
  it("is supplied by the frame from the tenant's own setting", () => {
    const shell = source("components/app-shell.tsx");
    expect(shell).toContain("TenantIllustrationProvider");
    expect(shell).toMatch(
      /tenant\.illustrationUrl \?\? platformIllustration\(\)/,
    );
  });
});
