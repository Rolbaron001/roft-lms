/**
 * What somebody is told when their Claude token has died.
 *
 * Roland, 20 September, hitting it for the second time: "So now I can't
 * remember where I got the token from... Please point me to where I get a new
 * one or boost the current one."
 *
 * The message named the command and stopped there. It did not say which
 * machine to run it on - and the natural reading, sitting in a browser looking
 * at a hosted platform, is that it happens somewhere on the platform. Nor did
 * it mention that plain `claude` usually fails in PowerShell, which is the
 * wall he would have hit next.
 *
 * The full instructions did exist: on the Settings page, under "Where the
 * token comes from". But that panel only appears once Claude Code is selected
 * in the dropdown, two clicks away on a different screen from where this error
 * is read. Knowing something and not saying it where somebody needs it is the
 * fault this whole week has been about.
 *
 * "Boost the current one" is worth answering too: a revoked token cannot be
 * renewed, and saying so stops somebody hunting for the button that would.
 *
 * Asserted against the source. Driving the real CLI to produce a 401 would
 * need a genuinely revoked token, and inventing a credential to test with is
 * the thing this codebase refuses to do everywhere else.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const provider = readFileSync(
  join(process.cwd(), "lib/extensions/claude-code.ts"),
  "utf8",
);

describe("the revoked-token message", () => {
  it("says which machine to run the command on", () => {
    // The whole point. "Run claude setup-token", read from a browser looking
    // at a hosted platform, suggests it happens on the platform.
    expect(provider).toMatch(/On your own computer - not on the server/);
  });

  it("gives the Windows form, which is the next wall", () => {
    // Plain `claude` in PowerShell fails on the execution policy. The .cmd
    // shim sidesteps it without changing any security setting.
    expect(provider).toMatch(/claude\.cmd setup-token/);
    expect(provider).toMatch(/running scripts is disabled on this system/);
    expect(provider).toMatch(/Mac or Linux: claude setup-token/);
  });

  it("answers 'can I boost the current one' with no", () => {
    expect(provider).toMatch(/cannot be renewed or extended/);
  });

  it("says what a good token looks like and where it goes", () => {
    expect(provider).toMatch(/beginning sk-ant-oat/);
    expect(provider).toMatch(/Paste it into Settings/);
  });

  it("still says it is nobody's fault and nothing was lost", () => {
    // The original got this right and it is worth keeping: the provider's own
    // words about an API being revoked read as a platform fault, and it is
    // not one.
    expect(provider).toMatch(/Nothing is wrong with the platform/);
    expect(provider).toMatch(/affects only you/);
  });

  it("is reached for every way the CLI reports a dead credential", () => {
    // 401, "revoked", "expired", "unauthorized" and the API-key wordings all
    // land on the same explanation, because they are one problem to the person
    // reading it.
    for (const wording of [
      "revoked",
      "expired",
      "unauthorized",
      "401",
      "authentication_error",
    ]) {
      expect(provider).toContain(`includes("${wording}")`);
    }
  });
});
