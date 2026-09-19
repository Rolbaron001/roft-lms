import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiProvider, Availability, ExtensionResult } from "./base";

/**
 * Google Gemini, called over HTTP with the person's own API key.
 *
 * The first provider that can run where the platform actually runs. Claude
 * Code works by shelling out to a CLI on the machine, which is fine on a
 * laptop and impossible on the server — the application is in a container with
 * no CLI, so that provider reports itself unavailable there and always will.
 * That is why the qualification test with Heidi on 16 September could not have
 * succeeded: the folder route needs a model, and no model could be reached.
 *
 * This one needs nothing installed. It needs a key.
 *
 * **An API key is not a subscription.** A Gemini Advanced subscription does
 * not grant API access; they are separate products with separate billing.
 * Everybody assumes otherwise, Roland included, so the settings screen says it
 * without being asked. What makes Gemini the right one to do first is that its
 * API has a genuinely free tier, so this can be tested without anybody buying
 * anything.
 *
 * The key belongs to the person, is supplied per run, and is never written
 * anywhere - not to a file, not to a log, not into an error message. It is
 * sent as a header rather than in the query string, because query strings end
 * up in access logs and headers do not.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * How much of the staged documents to send.
 *
 * Gemini's context is large enough for a curriculum several times over - the
 * Commercial Cleaner is about 150,000 characters - so this is a guard against
 * a pathological folder rather than a real limit. Reaching it refuses the run
 * rather than sending what fits: a plan built from half a curriculum looks
 * exactly like a plan built from all of it.
 */
const MAX_INPUT_CHARS = 600_000;

/*
 * What a real qualification actually comes to, measured 18 September against
 * the published documents in tests/fixtures rather than estimated:
 *
 *   121151 HRM Officer   curriculum 152,120 + qualification 26,019
 *                        + assessment specification 10,821  =  188,960
 *   118709 Commercial Cleaner   curriculum 152,873 + qualification 17,154
 *   121150                      curriculum 151,444
 *   SP220320 skills programme   curriculum  20,948
 *
 * So a full set of base documents is around a third of the cap, and every
 * curriculum published so far lands near 150,000 characters. Reaching 600,000
 * really does mean something pathological - a folder holding three unrelated
 * qualifications, or a scan that came back as noise - which is what makes
 * refusing the honest answer rather than a cautious one.
 *
 * Only the base documents are staged in the first place; the folder reader
 * filters to those, so a folder of eighty workbooks does not count against
 * this at all.
 */

/**
 * The documents the caller staged, read back as text.
 *
 * The contract offers a provider a working directory. Claude Code uses it as a
 * directory, because it is an agent with file tools. Gemini is not: it is one
 * request and one answer, so the files are read here and put in the prompt.
 * The caller already accepts an answer returned as text rather than written to
 * a file, so nothing above this needs to know the difference.
 */
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
 * Google's error text, without ever echoing the key back.
 *
 * Google puts the key in the body of some errors - "API key not valid:
 * AIza...". Passing that through would print a live credential on somebody's
 * screen and into whatever records the message. The named cases below replace
 * it anyway, but the fall-through does not, so the key is removed from the
 * text before any of them are considered rather than relying on each branch to
 * remember.
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

  if (status === 400 && /api key not valid/i.test(message)) {
    return "That Gemini API key is not valid. Check it was copied whole from Google AI Studio - it is not the same thing as a Gemini Advanced subscription, which does not include API access.";
  }
  if (status === 401 || status === 403) {
    return "Google refused that key. It may have been revoked, or the Generative Language API may not be enabled on the project it belongs to. Nothing is wrong with the platform and nothing was lost.";
  }
  if (status === 429) {
    return "Google's rate limit for that key has been reached. The free tier allows a limited number of requests a minute; wait and try again, or use a key with billing enabled.";
  }
  if (status >= 500) {
    /*
     * Worded from three failed attempts on 19 September rather than from the
     * status code alone. A 503 on a small request is worth retrying; a 503 on
     * a whole curriculum, three times running, is the size of the job rather
     * than Google having a bad minute, and telling somebody to try again is
     * how they spend an afternoon doing exactly that.
     */
    return `Google reported a problem on their side (${status}). A small request is worth simply trying again. If this was a whole qualification and it has now failed more than once, the request is most likely too large for the model to complete - import it from its documents instead, which reads the curriculum directly with no model involved.`;
  }
  return message || `Gemini returned ${status}.`;
}

export const geminiProvider: AiProvider = {
  name: "gemini",
  label: "Google Gemini (API key)",
  description:
    "Uses your own Google AI Studio API key. Not a Gemini Advanced subscription — that is a separate product and does not include API access. The API has a free tier, so this can be used without buying anything, within its rate limits.",
  writesFiles: false,
  credentialFormat: {
    word: "API key",
    /*
     * Deliberately not a prefix check.
     *
     * This was /^AIza.../ on 19 September, written from memory of what a
     * Google key looks like. Roland's real key begins "AQ.Ab", so the check
     * would have refused the very thing it was added to accept - the same
     * failure as the Claude-only rule it replaced, one commit later, and in
     * the worst direction: it fails closed on a valid credential and tells
     * somebody holding the right thing that they are wrong.
     *
     * Google has issued at least two formats and may issue a third. Guessing
     * at the next one is not a game worth playing, and this check was never
     * able to say whether a key is genuine - only the provider can, and it
     * does so clearly on the first call.
     *
     * So what is left is the question it can actually answer: is this another
     * provider's credential pasted into the wrong box? Anything starting sk-
     * is Claude's or OpenAI's, and that is the mistake somebody switching
     * provider actually makes.
     */
    shape: /^(?!sk-)[A-Za-z0-9._-]{20,}$/,
    source: "sign in at aistudio.google.com and choose Get API key",
  },
  /*
   * A starting point with a shelf life, not a promise.
   *
   * This said gemini-2.5-flash until 19 September, when Google answered a
   * valid request with "no longer available to new users - use
   * models/gemini-3.6-flash". Written from memory, correct once, wrong within
   * the month, and the failure landed on the person trying to use it.
   *
   * `listModels` below is the actual answer: anybody can see what their own
   * key reaches today and pick from that. This is only what happens when they
   * have not.
   */
  defaultModel: "gemini-3.6-flash",

  /**
   * What this key can use, from Google rather than from this file.
   *
   * Filtered to models that can answer a generateContent call, because the
   * list also carries embedding and vision models that would fail confusingly
   * if somebody picked one.
   */
  async listModels(token: string): Promise<string[]> {
    const response = await fetch(ENDPOINT, {
      headers: { "x-goog-api-key": token },
    });

    if (!response.ok) {
      throw new Error(
        explain(response.status, await response.json().catch(() => null), token),
      );
    }

    const body = (await response.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };

    return (body.models ?? [])
      .filter((one) =>
        (one.supportedGenerationMethods ?? []).includes("generateContent"),
      )
      .map((one) => (one.name ?? "").replace(/^models\//, ""))
      .filter(Boolean)
      .sort();
  },

  /**
   * Always available where there is a network.
   *
   * Nothing has to be installed and nothing has to be signed in on the
   * machine, which is the whole difference from the CLI-backed provider.
   * Whether the person's key works is answered by using it, not by guessing
   * here - a key check that costs a request would be a request that teaches
   * nothing the first real call does not.
   */
  availability(): Availability {
    return { available: true };
  },

  async run(input): Promise<ExtensionResult> {
    const started = Date.now();

    if (!input.token) {
      return {
        ok: false,
        error:
          "No Gemini API key is stored for you. Add one in Settings - it comes from Google AI Studio, and is not the same as a Gemini subscription.",
      };
    }

    const model = input.model?.trim() || this.defaultModel;

    const staged = input.workdir
      ? await documentsIn(input.workdir)
      : { text: "", truncated: false, files: 0 };

    /*
     * Refused rather than truncated.
     *
     * A plan built from half a curriculum looks exactly like a plan built from
     * all of it - same shape, same confidence, fewer modules - and nobody
     * checking it would know which they were looking at. The cap is generous
     * enough that reaching it means something pathological rather than a large
     * qualification, so the honest answer is to stop.
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
      const response = await fetch(
        `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            // A header, not a query parameter: query strings reach access logs.
            "x-goog-api-key": input.token,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            ...(input.system
              ? { systemInstruction: { parts: [{ text: input.system }] } }
              : {}),
            generationConfig: {
              // The callers here all want JSON and parse what comes back.
              responseMimeType: "application/json",
              temperature: 0,
            },
          }),
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        return {
          ok: false,
          error: explain(response.status, body, input.token),
          durationMs: Date.now() - started,
        };
      }

      const candidate = (
        body as {
          candidates?: {
            finishReason?: string;
            content?: { parts?: { text?: string }[] };
          }[];
        }
      )?.candidates?.[0];

      const text =
        candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

      /*
       * An answer that stopped because it ran out of room is not an answer.
       *
       * The input side of this already refuses rather than truncating, on the
       * grounds that a plan built from half a curriculum looks exactly like a
       * plan built from all of it. The output side did not, so a curriculum
       * too large to state in one reply came back as ok with the JSON cut
       * mid-sentence - and whether that was caught depended on whether the
       * truncation happened to land somewhere unparseable.
       *
       * A whole occupational curriculum is a lot to ask for in one reply: the
       * 121151 documents come to 15 modules, 51 topics, 499 elements and 154
       * criteria. Saying so is more use than a parse error three steps later.
       */
      if (candidate?.finishReason === "MAX_TOKENS") {
        return {
          ok: false,
          error:
            "Gemini ran out of room before it finished answering, so what came back is part of a curriculum rather than all of it - and a partial one looks exactly like a complete one. Nothing was kept. A whole qualification is a great deal to ask for in a single reply; import it from its documents instead, which reads the curriculum directly with no model involved and no limit of this kind.",
          durationMs: Date.now() - started,
        };
      }

      if (!text.trim()) {
        return {
          ok: false,
          error:
            "Gemini answered with nothing. That usually means the request was refused by a safety filter, or the model name is wrong.",
          durationMs: Date.now() - started,
        };
      }

      return {
        ok: true,
        text,
        model,
        durationMs: Date.now() - started,
        // Google does not report a per-call price, and a figure invented here
        // would be worse than none. Left unset rather than set to zero: zero
        // means "this cost nothing", which is true of a subscription-backed
        // provider and is not true here.
        raw: { files: staged.files },
      };
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || /abort/i.test(error.message));

      return {
        ok: false,
        error: aborted
          ? "Gemini did not answer in time. A large folder can take several minutes; trying again with fewer documents in it usually works."
          : "Gemini could not be reached. Check that this machine has a network connection to Google.",
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
