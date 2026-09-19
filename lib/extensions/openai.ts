import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiProvider, Availability, ExtensionResult } from "./base";

/**
 * OpenAI, called over HTTP with the person's own API key.
 *
 * The same shape as the Gemini provider beside it, and for the same reason:
 * nothing to install, so it runs on the server as well as on a laptop, unlike
 * the CLI-backed Claude provider.
 *
 * **A ChatGPT Plus subscription is not API access.** They are separate
 * products with separate billing, and paying for the first gives nothing
 * towards the second. Gemini was done first because its API has a free tier
 * and this one does not: every call here is charged against the key's own
 * account, so somebody switching to it should expect a bill, however small.
 *
 * The key belongs to the person, is supplied per run, and is never written
 * anywhere - not to a file, not to a log, not into an error message.
 */

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** As Gemini: a guard against a pathological folder, not a real limit. */
const MAX_INPUT_CHARS = 400_000;

async function documentsIn(workdir: string): Promise<{
  text: string;
  truncated: boolean;
  files: number;
}> {
  let entries: string[];
  try {
    entries = await readdir(workdir);
  } catch {
    return { text: "", truncated: false, files: 0 };
  }

  const parts: string[] = [];
  let total = 0;
  let truncated = false;
  let files = 0;

  for (const name of entries.sort()) {
    // Written by the caller for the answer, not for the question.
    if (name === "proposal.json") continue;

    let body: string;
    try {
      body = await readFile(join(workdir, name), "utf8");
    } catch {
      continue;
    }

    files += 1;
    const remaining = MAX_INPUT_CHARS - total;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const slice = body.slice(0, remaining);
    if (slice.length < body.length) truncated = true;
    total += slice.length;
    parts.push(`--- ${name} ---\n${slice}`);
  }

  return { text: parts.join("\n\n"), truncated, files };
}

/**
 * OpenAI's error text, with the key removed first.
 *
 * Stripped before any branch is considered rather than relying on each to
 * remember, which is how the same guard is written for Gemini. Some error
 * bodies quote the credential back.
 */
function explain(status: number, body: unknown, token?: string): string {
  const raw =
    typeof body === "object" && body !== null
      ? String(
          (body as { error?: { message?: string } }).error?.message ??
            JSON.stringify(body).slice(0, 400),
        )
      : String(body ?? "").slice(0, 400);

  const message =
    token && token.length >= 8 ? raw.split(token).join("[key removed]") : raw;

  if (status === 401) {
    return "OpenAI refused that key. It may have been revoked, or it may never have been valid. Note that a ChatGPT Plus subscription does not include API access - an API key is a separate thing, created at platform.openai.com. Nothing is wrong with the platform and nothing was lost.";
  }
  if (status === 403) {
    return "OpenAI refused that key for this model. The account it belongs to may not have access to the model named in your settings.";
  }
  if (status === 429) {
    return /quota|billing/i.test(message)
      ? "That OpenAI account has no credit left. Unlike Gemini, the OpenAI API has no free tier: it is charged against the account the key belongs to."
      : "OpenAI's rate limit for that key has been reached. Wait a little and try again.";
  }
  if (status >= 500) {
    return `OpenAI reported a problem on their side (${status}). This is worth simply trying again.`;
  }
  return message || `OpenAI returned ${status}.`;
}

export const openAiProvider: AiProvider = {
  name: "openai",
  label: "OpenAI (API key)",
  description:
    "Uses your own OpenAI API key, created at platform.openai.com. Not a ChatGPT Plus subscription — that is a separate product and does not include API access. Unlike Gemini there is no free tier, so calls are charged to the account the key belongs to.",
  writesFiles: false,
  credentialFormat: {
    word: "API key",
    /*
     * Every OpenAI key family begins sk-: the classic ones, project keys
     * (sk-proj-…) and service account keys (sk-svcacct-…). The length is left
     * loose, because the part after the prefix has changed more than once and
     * refusing a valid key over its length is the worse error.
     *
     * Anthropic's begin sk-ant-, so those are excluded rather than quietly
     * accepted. Somebody switching between the two is exactly who pastes the
     * wrong one, and "sk-" alone would have taken a Claude token happily and
     * failed later against OpenAI with a message from OpenAI about a key it
     * had never issued.
     */
    shape: /^sk-(?!ant-)[A-Za-z0-9_-]{16,}$/,
    source: "create one at platform.openai.com under API keys",
    looksLike: "sk-",
  },
  // A starting point, not a promise. See listModels, and gemini.ts for what
  // happens when a hardcoded model name outlives the provider's willingness
  // to serve it.
  defaultModel: "gpt-5",

  /** What this key can use, from OpenAI rather than from this file. */
  async listModels(token: string): Promise<string[]> {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(
        explain(response.status, await response.json().catch(() => null)),
      );
    }

    const body = (await response.json()) as { data?: { id?: string }[] };

    return (body.data ?? [])
      .map((one) => one.id ?? "")
      .filter(Boolean)
      .sort();
  },

  /** Nothing to install and nothing signed in on the machine. */
  availability(): Availability {
    return { available: true };
  },

  async run(input): Promise<ExtensionResult> {
    const started = Date.now();

    if (!input.token) {
      return {
        ok: false,
        error:
          "No OpenAI API key is stored for you. Add one in Settings - it comes from platform.openai.com, and is not the same as a ChatGPT subscription.",
      };
    }

    const model = input.model?.trim() || this.defaultModel;

    const staged = input.workdir
      ? await documentsIn(input.workdir)
      : { text: "", truncated: false, files: 0 };

    /*
     * Refused rather than truncated, for the reason given in the Gemini
     * provider: a plan built from half a curriculum looks exactly like a plan
     * built from all of it.
     */
    if (staged.truncated) {
      return {
        ok: false,
        error: `Those documents come to more than ${Math.round(MAX_INPUT_CHARS / 1000)},000 characters, which is more than can be sent in one request. Import the qualification from its documents instead - the curriculum document alone is read directly, with no model involved.`,
        durationMs: Date.now() - started,
      };
    }

    const prompt = staged.text
      ? `${input.prompt}\n\nThe documents follow.\n\n${staged.text}`
      : input.prompt;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      input.timeoutMs ?? 900_000,
    );

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.token}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(input.system
              ? [{ role: "system", content: input.system }]
              : []),
            { role: "user", content: prompt },
          ],
          // Every caller here parses JSON out of the answer.
          response_format: { type: "json_object" },
        }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        return {
          ok: false,
          error: explain(response.status, body, input.token),
          durationMs: Date.now() - started,
        };
      }

      const text =
        (body as { choices?: { message?: { content?: string } }[] })
          ?.choices?.[0]?.message?.content ?? "";

      if (!text.trim()) {
        return {
          ok: false,
          error:
            "OpenAI answered with nothing. That usually means the model name is wrong, or the request was refused.",
          durationMs: Date.now() - started,
        };
      }

      return {
        ok: true,
        text,
        model,
        durationMs: Date.now() - started,
        // Usage is reported in tokens rather than money, and the price per
        // token is not something this platform should pretend to know. Left
        // unset rather than guessed.
        raw: { files: staged.files },
      };
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || /abort/i.test(error.message));

      return {
        ok: false,
        error: aborted
          ? "OpenAI did not answer in time. A large folder can take several minutes; trying again with fewer documents in it usually works."
          : "OpenAI could not be reached. Check that this machine has a network connection.",
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
