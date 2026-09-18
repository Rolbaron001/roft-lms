/**
 * Choosing a provider that cannot run where the platform is.
 *
 * The qualification test on 16 September failed because Claude Code cannot run
 * on the server - the image holds the built application and no CLI - and the
 * folder screen was taught to say so. This screen, one step earlier, was not.
 * It listed Claude Code first, defaulted to it, and walked somebody through
 * generating a token on their own computer. The whole setup could be completed
 * correctly and still never work, with nothing anywhere saying why.
 *
 * Two rules come out of that, and both are about a deployment other than the
 * one these tests run on: locally Claude Code is usually installed and the
 * warning correctly stays hidden, so the case that matters is the one nobody
 * developing this will see.
 *
 * A provider that cannot run here must be marked in the list, and must not be
 * what somebody is given by default. Their own stored choice still stands -
 * it is theirs, the warning explains it, and changing it under them would be
 * worse than letting them see it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { knownProviders } from "@/lib/extensions";

const form = readFileSync(
  join(process.cwd(), "app/settings/extension-form.tsx"),
  "utf8",
);
const page = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);

/** What the form does, reproduced from the source it is taken from. */
function defaultChoice(
  stored: string | null,
  providers: { name: string; runsHere: boolean }[],
): string {
  return (
    stored ??
    providers.find((row) => row.runsHere)?.name ??
    providers[0]?.name ??
    ""
  );
}

const ON_A_SERVER = [
  { name: "claude_code", runsHere: false },
  { name: "gemini", runsHere: true },
  { name: "openai", runsHere: true },
];

describe("choosing an AI provider", () => {
  it("does not default to one that cannot run here", () => {
    expect(defaultChoice(null, ON_A_SERVER)).toBe("gemini");
  });

  it("keeps a choice somebody already made, even where it cannot run", () => {
    // Theirs, and the warning says what is wrong with it. Silently swapping it
    // would leave them looking at a provider they did not pick.
    expect(defaultChoice("claude_code", ON_A_SERVER)).toBe("claude_code");
  });

  it("still works where every provider can run", () => {
    const laptop = ON_A_SERVER.map((row) => ({ ...row, runsHere: true }));
    expect(defaultChoice(null, laptop)).toBe("claude_code");
  });

  it("marks the ones that cannot run, in the list itself", () => {
    // In the option text, not only in a note underneath: the list is what
    // somebody reads before choosing.
    expect(form).toContain("cannot run on this platform");
    expect(form).toMatch(/row\.runsHere \? "" :/);
  });

  it("says what to do instead rather than only what is wrong", () => {
    expect(form).toMatch(/Choose one of the API-key providers instead/);
  });

  it("asks each provider rather than assuming", () => {
    // The answer differs by deployment. A hardcoded list would be right on a
    // laptop and wrong on the server, which is the fault this replaces.
    expect(page).toMatch(/provider\.availability\(/);
    expect(page).toMatch(/runsHere: here\.available/);
  });

  /**
   * At least one provider must work wherever this is deployed, or the feature
   * is unreachable and the warning is all anybody ever sees.
   */
  it("leaves at least one provider that needs nothing installed", async () => {
    const overNetwork = await Promise.all(
      knownProviders()
        .filter((one) => one.name !== "claude_code")
        .map(async (one) => (await one.availability()).available),
    );

    expect(overNetwork.length).toBeGreaterThan(0);
    expect(overNetwork.every(Boolean)).toBe(true);
  });
});
