/**
 * Switching from one provider to another, which did not work at all.
 *
 * Roland tried to move from Claude Code to Gemini on 19 September, on
 * production, in order to test the Gemini path. Three separate faults stopped
 * him, and each one alone was enough:
 *
 * The select jumped back to Claude on save. React resets a form's DOM once a
 * form action resolves; the select is controlled, so React only writes to it
 * when its value changes - and after a failed save the state has not changed,
 * so nothing re-writes it and the browser's reset stands. What he photographed
 * was "Which one" reading Claude Code above Gemini's description, Gemini's
 * "Your API key" field and Gemini's guide. The display was the visible half;
 * the dangerous half is that the DOM is what a form submits, so the next save
 * posted claude_code while the screen said Gemini.
 *
 * The credential was judged by Claude's rule whoever had been chosen. One
 * constant, `sk-ant-oat…`, tested against everything anybody pasted - so a
 * Gemini key beginning AIza was refused with "That does not look like a Claude
 * Code token". The person is holding exactly the right thing and being told to
 * fetch a different one.
 *
 * And "Paste a token first. Run `claude setup-token`…" was the answer to an
 * empty box regardless of provider, which for somebody setting up Gemini is an
 * instruction to go and install a different product.
 *
 * All three are the same fault as the ones found on 18 September: Claude-only
 * assumptions surviving in code that now serves three providers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { knownProviders, providerByName } from "@/lib/extensions";

const form = readFileSync(
  join(process.cwd(), "app/settings/extension-form.tsx"),
  "utf8",
);

describe("every provider's credential", () => {
  it("has a shape of its own", () => {
    for (const provider of knownProviders()) {
      expect(provider.credentialFormat.shape).toBeInstanceOf(RegExp);
      expect(provider.credentialFormat.word.length).toBeGreaterThan(0);
      expect(provider.credentialFormat.source.length).toBeGreaterThan(0);
    }
  });

  it("accepts its own and refuses another's", () => {
    // Shapes only. Nothing here is a real credential, and a real one would
    // never belong in a test file.
    const samples: Record<string, string> = {
      claude_code: "sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      gemini: "AQ.AbSOMETHINGnotARealKey1234567890abcd",
      openai: "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    };

    for (const provider of knownProviders()) {
      const mine = samples[provider.name];
      expect(
        provider.credentialFormat.shape.test(mine),
        `${provider.name} refuses its own`,
      ).toBe(true);

      for (const [other, sample] of Object.entries(samples)) {
        if (other === provider.name) continue;
        // No exemptions. OpenAI's rule used to accept a Claude token, because
        // both begin sk-; it now excludes sk-ant- explicitly, so every
        // crossing is refused.
        expect(
          provider.credentialFormat.shape.test(sample),
          `${provider.name} accepted ${other}'s`,
        ).toBe(false);
      }
    }
  });

  /**
   * Both formats Google has actually issued.
   *
   * The Gemini rule was /^AIza…/ for about an hour on 19 September, written
   * from memory. Roland's real key begins "AQ.Ab", so it would have been
   * refused - the same failure as the Claude-only rule it replaced, one
   * commit later, and failing closed on a valid credential.
   */
  it("accepts every Gemini key format Google has issued", () => {
    const gemini = providerByName("gemini")!;

    for (const sample of [
      "AIzaSyeXAMPLEnotARealKey1234567890abcd",
      "AQ.AbSOMETHINGnotARealKey1234567890abcd",
    ]) {
      expect(
        gemini.credentialFormat.shape.test(sample),
        `refused ${sample.slice(0, 6)}…`,
      ).toBe(true);
    }
  });

  it("promises a prefix only where the provider keeps one", () => {
    // Claude generates its own with a documented command, so the prefix is
    // safe to name. Google's is not, so nothing claims one.
    expect(providerByName("claude_code")!.credentialFormat.looksLike).toBe(
      "sk-ant-oat",
    );
    expect(providerByName("gemini")!.credentialFormat.looksLike).toBeUndefined();
  });

  /**
   * The counters and suffixes each provider has changed at least once.
   *
   * Every one of these is a credential family somebody could legitimately be
   * holding. A rule that pins the digits refuses a valid one the day the
   * issuer bumps them, which is the failure this whole set of checks has now
   * caused twice.
   */
  it("does not pin a version number it cannot promise", () => {
    const claude = providerByName("claude_code")!.credentialFormat.shape;
    for (const sample of [
      "sk-ant-oat01-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      "sk-ant-oat02-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      "sk-ant-oat-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    ]) {
      expect(claude.test(sample), `refused ${sample.slice(0, 14)}…`).toBe(true);
    }

    const openai = providerByName("openai")!.credentialFormat.shape;
    for (const sample of [
      "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      "sk-svcacct-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ]) {
      expect(openai.test(sample), `refused ${sample.slice(0, 12)}…`).toBe(true);
    }
  });

  /**
   * The one refusal that is about kind rather than shape.
   *
   * An Anthropic API key and a Claude Code token come from the same company
   * and are not interchangeable. Somebody holding a valid API key needs to be
   * told which product they have, not to check their typing.
   */
  it("refuses an Anthropic API key for the token-based provider", () => {
    const claude = providerByName("claude_code")!.credentialFormat.shape;
    expect(claude.test("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123")).toBe(
      false,
    );
  });

  it("is named without repeating itself when refused", () => {
    // The label carries its own parenthetical for the dropdown - "Google
    // Gemini (API key)" - which reads as a stutter once the word is appended.
    const gemini = providerByName("gemini");
    const name = gemini!.label.replace(/\s*\([^)]*\)\s*$/, "");
    expect(name).toBe("Google Gemini");
  });
});

describe("the provider the form posts", () => {
  it("comes from state, not from the select", () => {
    // A hidden field carries the answer, so a DOM reset cannot change what is
    // submitted. This is the half that was silently wrong.
    expect(form).toMatch(/<input type="hidden" name="provider" value=\{provider\} \/>/);
  });

  it("leaves the select unnamed, so it cannot post a stale value", () => {
    const select = form.slice(form.indexOf("<select"), form.indexOf("</select>"));
    expect(select).not.toMatch(/name="provider"/);
  });

  it("puts the chosen provider back after every render", () => {
    // Without this the box shows the wrong provider even though the form is
    // correct - which is what made it look like the save had been ignored.
    expect(form).toMatch(/providerSelect\.current\.value = provider/);
  });
});
