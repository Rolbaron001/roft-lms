/**
 * A tenant's graphic hosted somewhere else.
 *
 * The Settings field says "https://… or /your-graphic.png", and until today
 * only the second half was true. Next's image optimiser refuses any host not
 * listed in next.config's remotePatterns - it answers the request with 400,
 * "url parameter is not allowed" - so a tenant who pasted an https address got
 * no picture, no error, and nothing to tell them why. Confirmed by pointing
 * the local tenant at one and watching the request fail.
 *
 * The obvious fix, allowing every host in remotePatterns, turns the optimiser
 * into something that will fetch an arbitrary URL on the server's behalf for
 * anybody who can construct a link. That is a great deal to give away in
 * exchange for resizing a decorative graphic under a hundred pixels tall.
 *
 * So a remote address is drawn as a plain img and a local one still goes
 * through the optimiser. The rule has to hold in both components, because the
 * same graphic appears in both places and a tenant would otherwise see it on
 * one screen and not the other.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const config = readFileSync(join(root, "next.config.ts"), "utf8");

const COMPONENTS = [
  "components/tenant-illustration.tsx",
  "components/empty-state.tsx",
];

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("an illustration hosted elsewhere", () => {
  it("is told apart from one served from here", () => {
    for (const path of COMPONENTS) {
      // The test looks for the check rather than for its exact spelling: what
      // matters is that the component asks whether the address is remote.
      expect(source(path)).toContain("https?:");
    }
  });

  it("is drawn without the optimiser", () => {
    for (const path of COMPONENTS) {
      expect(source(path)).toContain("<img");
    }
  });

  it("still optimises one served from this platform", () => {
    for (const path of COMPONENTS) {
      expect(source(path)).toContain("<Image");
    }
  });

  /**
   * If somebody later opens the optimiser to every host, the plain-img path
   * stops being necessary and this stops being the right shape. A named host
   * is fine; a wildcard is the thing to notice.
   */
  it("does not open the optimiser to every host on the internet", () => {
    expect(config).not.toMatch(/hostname:\s*["']\*\*["']/);
  });
});
