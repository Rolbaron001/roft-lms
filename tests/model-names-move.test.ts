/**
 * Model names move, and this codebase must not pretend otherwise.
 *
 * On 19 September Google answered a perfectly good request with "models/
 * gemini-2.5-flash is no longer available to new users. Please update your
 * code to use models/gemini-3.6-flash". That name had been written here from
 * memory: correct when it was written, wrong within the month, and the failure
 * landed on Roland mid-test rather than on anybody who could have seen it
 * coming.
 *
 * It was the third time in one day that an external provider's detail had been
 * asserted from memory - after the Gemini key prefix and the Claude token
 * format - and Roland's point was the right one: make provision for it rather
 * than fixing each instance.
 *
 * Bumping the default only resets the clock, so the provision is `listModels`:
 * a provider that can be asked is asked, and the person chooses from what
 * their own credential reaches today. What this file guards is that the
 * arrangement stays honest - that a model name lives in exactly one place per
 * provider, and that nothing else quietly keeps a copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { knownProviders, providerByName } from "@/lib/extensions";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("where a model name is allowed to live", () => {
  it("is the provider's own file and nowhere else", () => {
    /*
     * The form used to carry its own list of placeholders - gemini-2.5-flash,
     * gpt-5, claude-opus-5 - which is a second copy that nothing keeps in
     * step. It reads the provider's default now.
     */
    const form = source("app/settings/extension-form.tsx");
    for (const provider of knownProviders()) {
      expect(
        form.includes(provider.defaultModel),
        `${provider.defaultModel} is repeated in the settings form`,
      ).toBe(false);
    }

    expect(form).toMatch(/chosen\?\.defaultModel/);
  });

  it("is not pinned by a test either", () => {
    // The Gemini test asserted the literal "gemini-2.5-flash", so it would
    // have had to be edited on the day Google retired it: a test asserting
    // the very mistake it should have caught.
    const gemini = providerByName("gemini")!;
    const test = source("tests/gemini-provider.test.ts");
    expect(test).toContain("geminiProvider.defaultModel");
    expect(test.includes(`"${gemini.defaultModel}"`)).toBe(false);
  });
});

describe("asking the provider instead of guessing", () => {
  it("is offered by every provider that can answer", () => {
    // Claude Code takes a model name and publishes no list, so it is exempt -
    // and says so rather than showing an empty one.
    for (const provider of knownProviders()) {
      if (provider.name === "claude_code") {
        expect(provider.listModels).toBeUndefined();
        continue;
      }
      expect(
        typeof provider.listModels,
        `${provider.name} cannot be asked for its models`,
      ).toBe("function");
    }
  });

  it("is reachable from the screen", () => {
    const form = source("app/settings/extension-form.tsx");
    expect(form).toMatch(/listExtensionModelsAction\(\)/);
    expect(form).toMatch(/Show the models this/);
    // A provider that cannot be asked must not show the button at all.
    expect(form).toMatch(/chosen\?\.listsModels \?/);
  });

  it("returns names and never the credential", () => {
    // The listing takes the token as an argument and returns strings. Anything
    // richer would eventually carry the key back to a browser.
    const registry = source("lib/extensions/index.ts");
    expect(registry).toMatch(/models: string\[\]; error\?: string/);
    expect(registry).toMatch(/await provider\.listModels\(token\)/);
  });
});

/**
 * An answer that stopped early is not an answer.
 *
 * The input side of the Gemini provider already refuses rather than
 * truncating, on the stated grounds that a plan built from half a curriculum
 * looks exactly like a plan built from all of it. The output side did not: a
 * reply cut short by the model's own limit came back as ok, and whether that
 * was caught depended on where the cut happened to land.
 *
 * Roland's three failed attempts on 19 September were 503s rather than
 * truncation, but they are the same lesson - a whole occupational curriculum
 * is a great deal to ask for in one reply.
 */
describe("an answer that ran out of room", () => {
  it("is refused rather than returned", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              finishReason: "MAX_TOKENS",
              content: { parts: [{ text: '{"modules":[{"code":"KM0' }] },
            },
          ],
        }),
      }) as unknown as Response) as typeof fetch;

    try {
      const { geminiProvider } = await import("@/lib/extensions/gemini");
      const result = await geminiProvider.run({
        prompt: "read this",
        token: "AQ.AbNotARealKey0123456789abcdefghij",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ran out of room/i);
      // And it says what to do instead, rather than only what went wrong.
      expect(result.error).toMatch(/from its documents/i);
      // The half-answer must not travel on as if it were whole.
      expect(result.text).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
