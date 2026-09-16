/**
 * OpenAI, checked the same way its sibling is.
 *
 * Same shape as the Gemini provider and the same guards, so the same things
 * are asserted — above all that the key never reaches an error message. The
 * differences worth testing are its own: a bearer header rather than a Google
 * one, and no free tier, so an exhausted quota has to be explained as a bill
 * rather than as a wait.
 *
 * Nothing here calls OpenAI. `fetch` is replaced.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAiProvider } from "@/lib/extensions/openai";

const KEY = "sk-proj-not-a-real-key-000111222";

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
  return { choices: [{ message: { content: text } }] };
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
    expect((await openAiProvider.availability()).available).toBe(true);
  });
});

describe("the key", () => {
  it("is sent as a bearer header, never in the address", async () => {
    answering(200, answered('{"modules":[]}'));

    await openAiProvider.run({ prompt: "read this", token: KEY });

    const [call] = calls;
    // A query string reaches an access log; a header does not.
    expect(call.url).not.toContain(KEY);
    expect((call.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${KEY}`,
    );
  });

  it("never appears in an error, whatever Google says", async () => {
    // Google echoes the key back in some error bodies. Passing that through
    // would put a live credential on somebody's screen and in the audit trail.
    answering(400, {
      error: { message: `API key not valid: ${KEY}. Please pass a valid key.` },
    });

    const result = await openAiProvider.run({ prompt: "x", token: KEY });

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

    const result = await openAiProvider.run({ prompt: "x", token: KEY });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(KEY);
    expect(result.error).toContain("[key removed]");
  });

  it("says what to do when there is no key at all", async () => {
    const result = await openAiProvider.run({ prompt: "x" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Settings/);
    // The misconception this whole provider has to keep correcting.
    expect(result.error).toMatch(/not the same as a ChatGPT subscription/i);
  });
});

describe("what it does with the documents it is given", () => {
  it("sends the staged files with the prompt", async () => {
    answering(200, answered('{"modules":[]}'));

    const workdir = await mkdtemp(join(tmpdir(), "gemini-test-"));
    await writeFile(join(workdir, "curriculum.txt"), "KM01 Introduction", "utf8");

    await openAiProvider.run({ prompt: "read this", token: KEY, workdir });

    const sent = String(calls[0].init.body);
    expect(sent).toContain("KM01 Introduction");
    expect(sent).toContain("read this");
  });

  it("ignores the file the caller left for the answer", async () => {
    answering(200, answered('{"modules":[]}'));

    const workdir = await mkdtemp(join(tmpdir(), "gemini-test-"));
    await writeFile(join(workdir, "curriculum.txt"), "KM01", "utf8");
    await writeFile(join(workdir, "proposal.json"), "{\"stale\":true}", "utf8");

    await openAiProvider.run({ prompt: "p", token: KEY, workdir });

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

    const result = await openAiProvider.run({
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

    const result = await openAiProvider.run({ prompt: "p", token: KEY });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nothing/i);
  });
});

describe("what it says when Google says no", () => {
  it("tells a spent quota apart from a rate limit", async () => {
    // The difference matters: one is a wait, the other is a bill. OpenAI
    // returns 429 for both.
    answering(429, {
      error: { message: "You exceeded your current quota, check your billing" },
    });
    const spent = await openAiProvider.run({ prompt: "p", token: KEY });
    expect(spent.error).toMatch(/no credit left/i);

    answering(429, { error: { message: "Rate limit reached for requests" } });
    const busy = await openAiProvider.run({ prompt: "p", token: KEY });
    expect(busy.error).toMatch(/wait a little/i);
  });

  it("explains a refused key without blaming the platform", async () => {
    answering(401, { error: { message: "Incorrect API key provided" } });

    const result = await openAiProvider.run({ prompt: "p", token: KEY });

    expect(result.error).toMatch(/revoked|never have been valid/i);
    expect(result.error).toMatch(/nothing is wrong with the platform/i);
    // And corrects the assumption that sends people here in the first place.
    expect(result.error).toMatch(/ChatGPT Plus/);
  });

  it("suggests trying again when the fault is Google's", async () => {
    answering(503, { error: { message: "Service unavailable" } });

    const result = await openAiProvider.run({ prompt: "p", token: KEY });

    expect(result.error).toMatch(/their side/i);
  });
});

describe("a good answer", () => {
  it("comes back as text the caller can parse", async () => {
    answering(200, answered('{"modules":[{"code":"KM01"}]}'));

    const result = await openAiProvider.run({ prompt: "p", token: KEY });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("KM01");
    expect(result.model).toBe("gpt-5");
  });

  it("asks for JSON, because every caller here parses one", async () => {
    answering(200, answered("{}"));

    await openAiProvider.run({ prompt: "p", token: KEY });

    expect(String(calls[0].init.body)).toContain("json_object");
  });

  /**
   * Not set to zero. Zero means "this cost nothing", which is true of a
   * subscription-backed provider and is not true of a metered key.
   */
  it("does not invent a cost", async () => {
    answering(200, answered("{}"));

    const result = await openAiProvider.run({ prompt: "p", token: KEY });

    expect(result.costUsd).toBeUndefined();
  });
});
