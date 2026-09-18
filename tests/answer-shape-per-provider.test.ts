/**
 * Asking for an answer in a form the provider can actually give.
 *
 * Claude Code is an agent with file tools: given a workspace it reads the
 * documents as files and writes its answer as a file, which it does far more
 * reliably than it returns JSON in prose. Gemini and OpenAI are HTTP calls -
 * they are handed the documents as text and the reply is the only thing that
 * comes back.
 *
 * `lib/folder-import.ts` wrote the Claude shape into the prompt itself: "Write
 * what they say to a file called proposal.json in this directory. Write
 * nothing else, and do not summarise your findings in your reply - the file is
 * the answer." Handed to Gemini, that is an instruction to return nothing
 * usable. So the single route Gemini was added for - reading a folder on the
 * server, where Claude Code cannot run at all - would have failed on the first
 * attempt, and failed as "the extension ran but wrote nothing that could be
 * read as a plan", which points at the model rather than at the prompt.
 *
 * Nothing in the suite could have caught it, because a prompt is a string and
 * every test that mattered mocked the call. What is checked here is the join:
 * that the caller no longer states a shape, that the registry states one per
 * provider, and that each provider declares which it is.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { knownProviders, readJson } from "@/lib/extensions";

const root = process.cwd();
const registry = readFileSync(join(root, "lib/extensions/index.ts"), "utf8");
const folderImport = readFileSync(join(root, "lib/folder-import.ts"), "utf8");

describe("where a provider is told to put its answer", () => {
  it("is decided per provider, not written into a caller's prompt", () => {
    // The caller names the file; the registry decides what to say about it.
    expect(folderImport).toContain('answerFile: "proposal.json"');
    expect(folderImport).not.toMatch(/the file is the answer/i);
    expect(registry).toMatch(/provider\.writesFiles/);
  });

  it("tells one that cannot write a file to reply with the object", () => {
    expect(registry).toMatch(/Reply with that JSON object and nothing else/);
  });

  it("is declared by every provider", () => {
    for (const provider of knownProviders()) {
      expect(typeof provider.writesFiles).toBe("boolean");
    }
  });

  /**
   * The one that matters on the server. Claude Code cannot run there, so if
   * every provider that can wrote files, folder import would be unreachable in
   * production - which is the state this fix exists to leave behind.
   */
  it("leaves a provider that answers in its reply", () => {
    const replying = knownProviders().filter((one) => !one.writesFiles);
    expect(replying.map((one) => one.name)).toContain("gemini");
  });

  it("still lets Claude Code answer the way it is good at", () => {
    const claude = knownProviders().find((one) => one.name === "claude_code");
    expect(claude?.writesFiles).toBe(true);
  });
});

/**
 * What actually comes back from a model asked for JSON, since that is now the
 * path folder import takes on the server.
 */
describe("reading a reply", () => {
  const plan = { title: "Occupational Certificate", modules: [] };

  it("reads a bare object", () => {
    expect(readJson(JSON.stringify(plan))).toEqual(plan);
  });

  it("reads one in a code fence, which is what models do anyway", () => {
    const fenced = "```json\n" + JSON.stringify(plan) + "\n```";
    expect(readJson(fenced)).toEqual(plan);
  });

  it("reads one with a sentence in front of it", () => {
    const chatty = `Here is the qualification:\n${JSON.stringify(plan)}`;
    expect(readJson(chatty)).toEqual(plan);
  });

  it("returns nothing for an answer that holds no object", () => {
    // The case the old prompt produced: a polite acknowledgement and no plan.
    expect(readJson("I have written the file as requested.")).toBeNull();
  });
});
