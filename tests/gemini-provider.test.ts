/**
 * The first provider that can run where the platform runs.
 *
 * Claude Code shells out to a CLI on the machine, which works on a laptop and
 * never on the server — the application is in a container without one, so that
 * provider reports itself unavailable there and always will. That is why the
 * qualification test with Heidi on 16 September could not have succeeded: the
 * folder route needs a model, and no model could be reached.
 *
 * Nothing here calls Google. `fetch` is replaced, so what is tested is what the
 * platform does with an answer, a refusal and a rate limit — and, more
 * importantly, what it does with the key.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiProvider } from "@/lib/extensions/gemini";

const KEY = "AIza-not-a-real-key-000111222";

let calls: { url: string; init: RequestInit }[] = [];
const realFetch = globalThis.fetch;

function answering(status: number, body: unknown) {
  globalThis.fetch = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function answered(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe("where it can run", () => {
  /**
   * The whole point. Nothing is installed, nothing is signed in on the
   * machine, so there is no deployment where this is unavailable for a reason
   * the platform could have prevented.
   */
  it("is available without anything installed", async () => {
    // The contract lets a provider answer this slowly; this one does not need
    // to, but the type says it might.
    expect((await geminiProvider.availability()).available).toBe(true);
  });
});

describe("the key", () => {
  it("is sent as a header, never in the address", async () => {
    answering(200, answered('{"modules":[]}'));

    await geminiProvider.run({ prompt: "read this", token: KEY });

    const [call] = calls;
    // A query string reaches an access log; a header does not.
    expect(call.url).not.toContain(KEY);
    expect(
      (call.init.headers as Record<string, string>)["x-goog-api-key"],
    ).toBe(KEY);
  });

  it("never appears in an error, whatever Google says", async () => {
    // Google echoes the key back in some error bodies. Passing that through
    // would put a live credential on somebody's screen and in the audit trail.
    answering(400, {
      error: { message: `API key not valid: ${KEY}. Please pass a valid key.` },
    });

    const result = await geminiProvider.run({ prompt: "x", token: KEY });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(KEY);
  });

  /**
   * The hole the test above did not cover. "API key not valid" returns a
   * canned sentence, so the key never survived that branch anyway - but any
   * other message Google sends falls through and is passed on, and some of
   * those carry the key too.
   */
  it("never appears in an error Google did not name", async () => {
    answering(400, {
      error: { message: `Something unexpected about ${KEY} went wrong.` },
    });

    const result = await geminiProvider.run({ prompt: "x", token: KEY });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(KEY);
    expect(result.error).toContain("[key removed]");
  });

  it("says what to do when there is no key at all", async () => {
    const result = await geminiProvider.run({ prompt: "x" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Settings/);
    // The misconception this whole provider has to keep correcting.
    expect(result.error).toMatch(/not the same as a Gemini subscription/i);
  });
});

describe("what it does with the documents it is given", () => {
  it("sends the staged files with the prompt", async () => {
    answering(200, answered('{"modules":[]}'));

    const workdir = await mkdtemp(join(tmpdir(), "gemini-test-"));
    await writeFile(join(workdir, "curriculum.txt"), "KM01 Introduction", "utf8");

    await geminiProvider.run({ prompt: "read this", token: KEY, workdir });

    const sent = String(calls[0].init.body);
    expect(sent).toContain("KM01 Introduction");
    expect(sent).toContain("read this");
  });

  it("ignores the file the caller left for the answer", async () => {
    answering(200, answered('{"modules":[]}'));

    const workdir = await mkdtemp(join(tmpdir(), "gemini-test-"));
    await writeFile(join(workdir, "curriculum.txt"), "KM01", "utf8");
    await writeFile(join(workdir, "proposal.json"), "{\"stale\":true}", "utf8");

    await geminiProvider.run({ prompt: "p", token: KEY, workdir });

    expect(String(calls[0].init.body)).not.toContain("stale");
  });
});

describe("what it refuses to do quietly", () => {
  /**
   * The failure worth refusing over. A plan built from half a curriculum looks
   * exactly like a plan built from all of it — same shape, same confidence,
   * fewer modules — and nobody checking it would know which they had.
   */
  it("refuses rather than sending only what fits", async () => {
    answering(200, answered('{"modules":[]}'));

    const workdir = await mkdtemp(join(tmpdir(), "gemini-test-"));
    await writeFile(join(workdir, "huge.txt"), "x".repeat(700_000), "utf8");

    const result = await geminiProvider.run({
      prompt: "p",
      token: KEY,
      workdir,
    });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
    // And names the route that has no such limit.
    expect(result.error).toMatch(/from its documents/i);
  });

  it("does not treat an empty answer as a plan", async () => {
    answering(200, answered("   "));

    const result = await geminiProvider.run({ prompt: "p", token: KEY });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing/i);
  });
});

describe("what it says when Google says no", () => {
  it("explains a rate limit as a wait rather than a fault", async () => {
    answering(429, { error: { message: "Resource exhausted" } });

    const result = await geminiProvider.run({ prompt: "p", token: KEY });

    expect(result.error).toMatch(/free tier/i);
  });

  it("explains a refused key without blaming the platform", async () => {
    answering(403, { error: { message: "Forbidden" } });

    const result = await geminiProvider.run({ prompt: "p", token: KEY });

    expect(result.error).toMatch(/revoked|not be enabled/i);
    expect(result.error).toMatch(/nothing is wrong with the platform/i);
  });

  it("suggests trying again when the fault is Google's", async () => {
    answering(503, { error: { message: "Service unavailable" } });

    const result = await geminiProvider.run({ prompt: "p", token: KEY });

    expect(result.error).toMatch(/their side/i);
  });
});

describe("a good answer", () => {
  it("comes back as text the caller can parse", async () => {
    answering(200, answered('{"modules":[{"code":"KM01"}]}'));

    const result = await geminiProvider.run({ prompt: "p", token: KEY });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("KM01");
    // Whatever the provider's own default is, not a name repeated here. This
    // said "gemini-2.5-flash" and would have had to be edited on the day
    // Google retired it - a test asserting the mistake it was meant to catch.
    expect(result.model).toBe(geminiProvider.defaultModel);
  });

  it("asks for JSON, because every caller here parses one", async () => {
    answering(200, answered("{}"));

    await geminiProvider.run({ prompt: "p", token: KEY });

    expect(String(calls[0].init.body)).toContain("application/json");
  });

  /**
   * Not set to zero. Zero means "this cost nothing", which is true of a
   * subscription-backed provider and is not true of a metered key.
   */
  it("does not invent a cost", async () => {
    answering(200, answered("{}"));

    const result = await geminiProvider.run({ prompt: "p", token: KEY });

    expect(result.costUsd).toBeUndefined();
  });
});
