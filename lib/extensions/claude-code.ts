import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiProvider, Availability, ExtensionResult } from "./base";

/**
 * The subscription-backed provider.
 *
 * Drives a locally installed Claude Code in headless mode, against whatever
 * subscription is signed in on the machine the platform is running on. No API
 * key, no per-token cost, and nothing in this module ever sees a credential:
 * Claude Code holds its own sign-in, so there is no column for one and no
 * field anywhere to type one into.
 *
 * What that buys and what it costs, said plainly because it decides where this
 * is usable:
 *
 *   - It works where Claude Code is installed and signed in. On a desktop that
 *     is one `claude` then `/login`.
 *
 *   - It works on the production server too. The Dockerfile installs the CLI
 *     into the application image, and each person's own token is handed to it
 *     per run, so nothing shared is signed in anywhere.
 *
 * **This paragraph used to say the opposite, and it was wrong.** It said the
 * provider "does not work on the production server, where nobody is signed in"
 * - true when it was written, before the CLI was added to the image and before
 * per-person tokens replaced a machine-wide sign-in. The comment outlived both
 * changes, and on 19 September I read it and repeated it to Roland as current
 * fact, several times and in writing, without ever looking in the container.
 * It steered a day of testing towards Gemini and nearly towards a paid API
 * key he did not need. Claude Code 2.1.278 has been in that image throughout.
 *
 * The licensing question is still real and is still his to answer: a personal
 * subscription driving a multi-tenant server puts one person's usage limits
 * behind everybody's work. Per-person tokens are what make that a choice
 * rather than a default - each run uses the credential of whoever asked.
 *
 * The executable moves whenever the desktop application updates, so it is
 * discovered at call time rather than configured, with LMS_CLAUDE_CLI as an
 * override for an installation this does not find.
 */

function versionKey(name: string): number[] {
  return name.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
}

function newerFirst(a: string, b: string): number {
  const left = versionKey(a);
  const right = versionKey(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Where the executable is.
 *
 * PATH first, because that is the installation the person controls. Then npm's
 * global bin, which is not always on the PATH of a service process even when
 * it is on the PATH of the terminal that installed it. Then the copy bundled
 * inside the desktop application, under a version directory - newest wins,
 * compared numerically, because a plain string sort puts 2.1.9 above 2.1.247.
 */
/**
 * Whether a subscription has been signed in where the platform runs.
 *
 * Claude Code writes its credentials under the home directory. Checking for
 * them separates "not installed" from "installed and nobody has signed in",
 * which are the same to a program and completely different to a person: one is
 * a deployment fault and the other is a five-minute job somebody has to choose
 * to do.
 *
 * A false positive here costs nothing. The run itself reports a missing
 * sign-in in its own words, so the worst case is a clearer message replaced by
 * a less clear one.
 */
export function profileDir(tenantId?: string): string | null {
  const base =
    process.env.CLAUDE_CONFIG_DIR ??
    (process.env.HOME ? join(process.env.HOME, ".claude") : null);

  if (!base) return null;
  // A directory per tenant. Claude Code keeps one sign-in per config
  // directory, not one per machine, so pointing it at a different directory
  // gives a different subscription - which is how one server carries Curiosa's
  // sign-in and ROFT's without either seeing the other's usage.
  return tenantId ? join(base, "tenants", tenantId) : base;
}

export function signedIn(tenantId?: string): boolean {
  const home = profileDir(tenantId);

  if (!home) return true;

  for (const marker of [".credentials.json", "credentials.json"]) {
    if (existsSync(join(home, marker))) return true;
  }

  // Claude Code also writes a .claude.json beside the directory it is given.
  if (existsSync(`${home}.json`)) return true;

  return false;
}

export function findClaudeCli(): string | null {
  const override = (process.env.LMS_CLAUDE_CLI ?? "").trim();
  if (override) return existsSync(override) ? override : null;

  const windows = process.platform === "win32";

  const onPath = (process.env.PATH ?? "")
    .split(windows ? ";" : ":")
    .filter(Boolean)
    .flatMap((directory) =>
      (windows ? ["claude.cmd", "claude.exe", "claude"] : ["claude"]).map(
        (name) => join(directory, name),
      ),
    )
    .find((candidate) => {
      try {
        return statSync(candidate).isFile();
      } catch {
        return false;
      }
    });

  if (onPath) return onPath;

  const roots: string[] = [];
  if (windows) {
    for (const variable of ["APPDATA", "LOCALAPPDATA"]) {
      const base = process.env[variable];
      if (base) {
        roots.push(join(base, "Claude", "claude-code"));
      }
    }
    const appdata = process.env.APPDATA;
    if (appdata) {
      for (const shim of ["claude.cmd", "claude.exe"]) {
        const candidate = join(appdata, "npm", shim);
        if (existsSync(candidate)) return candidate;
      }
    }
  } else {
    const home = process.env.HOME ?? "";
    roots.push(join(home, ".claude", "claude-code"));
    roots.push(join(home, ".local", "share", "Claude", "claude-code"));
  }

  const executable = windows ? "claude.exe" : "claude";
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let versions: string[];
    try {
      versions = readdirSync(root).sort(newerFirst);
    } catch {
      continue;
    }
    for (const version of versions) {
      const candidate = join(root, version, executable);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * How to launch what was found.
 *
 * An npm global install on Windows leaves a `.cmd` shim, which is a batch
 * script rather than an executable: it cannot be started directly and goes
 * through the command interpreter. The PowerShell shim npm also writes is
 * deliberately never used - a stock execution policy blocks it, which is
 * exactly the failure this avoids.
 */
function argv(cli: string): { command: string; prefix: string[] } {
  const lower = cli.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return {
      command: process.env.COMSPEC ?? "cmd.exe",
      prefix: ["/c", cli],
    };
  }
  return { command: cli, prefix: [] };
}

/** Claude Code writes one JSON object on stdout. A banner before it is fine. */
function parseOutput(stdout: string): Record<string, unknown> | null {
  const trimmed = (stdout ?? "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    /* fall through to a line scan */
  }

  const lines = trimmed.split("\n").reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

/** Turn the CLI's own wording into something the reader can act on. */
function explain(message: string): string {
  const lowered = (message ?? "").toLowerCase();

  if (lowered.includes("not logged in") || lowered.includes("/login")) {
    return "Claude Code is installed on this machine but nobody is signed in. Open a terminal, run claude, then /login and complete the sign-in in the browser. That is a one-time step and it is done by you, not by the platform.";
  }
  if (lowered.includes("usage limit") || lowered.includes("rate limit")) {
    return "The Claude subscription's usage limit has been reached. This will work again once the limit resets.";
  }

  /*
   * A token that has been revoked, expired, or was never valid.
   *
   * Roland hit this during the qualification test on 16 September with his
   * extension switched on, and what reached the screen was the provider's own
   * words about an API being revoked. That reads as a fault in the platform,
   * and it is not one: a token is generated by a person on their own machine
   * and can be withdrawn or expire without the platform being told. The only
   * useful thing to say is whose it is and how to replace it.
   *
   * It says the whole thing, including the Windows `.cmd` wrinkle, because on
   * 20 September Roland hit this a second time and asked where the token came
   * from. The instructions existed - on the Settings page, under "Where the
   * token comes from" - but that panel only appears once Claude Code is
   * selected in the dropdown, which is two clicks away on another screen from
   * where this error is read. A message that names a command without saying
   * which machine to run it on is half an instruction.
   */
  if (
    lowered.includes("revoked") ||
    lowered.includes("expired") ||
    lowered.includes("invalid api key") ||
    lowered.includes("invalid_api_key") ||
    lowered.includes("authentication_error") ||
    lowered.includes("unauthorized") ||
    lowered.includes("401")
  ) {
    return [
      "Your Claude token is no longer valid - it has been revoked, or it has expired.",
      "Nothing is wrong with the platform and nothing was lost, and this affects only you: a token is yours rather than the tenant's.",
      "It cannot be renewed or extended. Generate a new one, which replaces the old:",
      "1. On your own computer - not on the server - open a terminal.",
      "2. Windows, in PowerShell: claude.cmd setup-token. Note the .cmd; plain `claude` usually fails there with \"running scripts is disabled on this system\", which is a Windows default rather than a fault, and the .cmd form avoids it without changing any security setting. Mac or Linux: claude setup-token.",
      "3. Sign in when it opens your browser. You need a Claude subscription of your own.",
      "4. It prints a token beginning sk-ant-oat. Copy the whole string.",
      "5. Paste it into Settings, under your AI extension, and save.",
    ].join(" ");
  }

  return message.trim() || "Claude Code reported an error.";
}

export const claudeCodeProvider: AiProvider = {
  name: "claude_code",
  label: "Claude Code (subscription)",
  description:
    "Uses your own Claude subscription, through a token you generate on your own computer with `claude setup-token`. Not an API key: no per-token cost, and it draws on the subscription you already pay for rather than a shared one.",
  writesFiles: true,
  credentialFormat: {
    word: "token",
    /*
     * Loose about everything after the family, tight about the family.
     *
     * This demanded `sk-ant-oat` followed by exactly two digits and a hyphen,
     * which is what `claude setup-token` prints today. One more digit, or one
     * fewer, and a valid token would have been refused - the same failure that
     * an AIza-only rule caused for Gemini on 19 September, waiting to happen
     * here on the day Anthropic changes a counter.
     *
     * What is worth keeping is the one distinction that is a real mistake
     * rather than a guess about formatting: an Anthropic API key is
     * sk-ant-api…, a different product that this provider cannot use, and
     * pasting one here is an easy thing to do. That is caught by name below,
     * with its own message, because "wrong shape" would be useless advice for
     * somebody holding a perfectly good key of the wrong kind.
     */
    shape: /^sk-ant-(?!api)[A-Za-z0-9_-]{16,}$/,
    source: "run `claude setup-token` on your own computer; it prints one",
    looksLike: "sk-ant-oat",
  },
  defaultModel: "claude-opus-5",

  availability(tenantId?: string): Availability {
    const cli = findClaudeCli();
    if (!cli) {
      return {
        available: false,
        reason: "Claude Code is not installed where the platform is running.",
        /*
         * This used to say the hosted platform has it installed already, and
         * that seeing this meant the deployment was broken. Neither is true.
         * The application image contains the built application and nothing
         * else - no CLI - so on the server this provider is unavailable by
         * construction and always will be. Heidi hit exactly this on
         * 16 September, and a message telling her to report a fault would have
         * sent her to Roland with nothing wrong to find.
         */
        remedy:
          "This provider works by running a program on the same machine as the platform, and the hosted platform does not have it. That is by design rather than a fault: nothing is wrong with your account and there is nothing for anybody to fix. Choose Google Gemini or OpenAI instead - those are called over the internet and work wherever the platform runs. Claude Code remains the right choice when the platform is running on your own computer.",
      };
    }

    // Whether anybody is signed in on the machine is no longer the question.
    // Each person brings their own token and it is supplied per run, so a
    // server with no sign-in at all is a perfectly working deployment. What is
    // left to check is that the program exists.
    //
    // `tenantId` is still taken, and the profile directory still separated per
    // tenant, because Claude Code writes working state beside its credentials
    // and one tenant's should not land in another's.
    void tenantId;
    return { available: true, detail: cli };
  },

  async run(input): Promise<ExtensionResult> {
    const cli = findClaudeCli();
    if (!cli) {
      const state = this.availability() as Availability;
      return { ok: false, error: state.reason };
    }

    const model = input.model || this.defaultModel;
    const { command, prefix } = argv(cli);
    const args = [
      ...prefix,
      "-p",
      "--output-format",
      "json",
      "--model",
      model,
    ];
    if (input.system) args.push("--append-system-prompt", input.system);

    // A workspace is only useful if it may actually be read and written, and
    // in headless mode every tool is denied unless it is named. Read and Write
    // and nothing else: no Bash, no network, no editing anything outside the
    // directory it was given. Without this the model announces it has written
    // the file and has not, which is the failure this cost an afternoon to
    // find.
    if (input.workdir) {
      args.push(
        "--allowedTools",
        "Read,Write,Glob,Grep",
        "--permission-mode",
        "acceptEdits",
      );
    }

    // Claude Code takes its working directory as the project it may read. A
    // caller that has staged documents into a directory passes it; anything
    // else runs in an empty temporary one, so the platform's own source and
    // whatever else is on that machine are not in scope for a prompt about a
    // qualification document.
    const owned = !input.workdir;
    const workdir = input.workdir ?? (await mkdtemp(join(tmpdir(), "lms-ai-")));
    const started = Date.now();

    try {
      const output = await new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        const profile = profileDir(input.tenantId);
        const child = spawn(command, args, {
          cwd: workdir,
          windowsHide: true,
          // This person's own subscription, for this run and no other.
          //
          // Passed in the environment of the child process rather than written
          // anywhere: it exists for the life of one spawn and leaves nothing on
          // disk. CLAUDE_CODE_OAUTH_TOKEN is what Claude Code reads a
          // subscription token from - verified against `claude auth status`,
          // which reports authMethod "oauth_token" when it is set.
          //
          // The config directory is still separated per tenant, because the
          // program writes working state there even when the credential comes
          // from the environment.
          env: {
            ...process.env,
            ...(profile ? { CLAUDE_CONFIG_DIR: profile } : {}),
            ...(input.token ? { CLAUDE_CODE_OAUTH_TOKEN: input.token } : {}),
          },
        });

        let stdout = "";
        let stderr = "";
        const timer = setTimeout(
          () => {
            child.kill();
            reject(new Error("timeout"));
          },
          input.timeoutMs ?? 600_000,
        );

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });

        child.stdin.write(input.prompt);
        child.stdin.end();
      });

      const durationMs = Date.now() - started;
      const payload = parseOutput(output.stdout);

      if (!payload) {
        const detail = (output.stderr || output.stdout || "").trim();
        return {
          ok: false,
          model,
          durationMs,
          error: detail.slice(0, 500) || "Claude Code returned no output.",
        };
      }

      const text = String(payload.result ?? "");
      if (payload.is_error) {
        return {
          ok: false,
          model,
          durationMs,
          error: explain(text),
          raw: payload,
        };
      }

      return {
        ok: true,
        text,
        model,
        durationMs,
        costUsd: Number(payload.total_cost_usd ?? 0),
        raw: payload,
      };
    } catch (error) {
      const durationMs = Date.now() - started;
      if (error instanceof Error && error.message === "timeout") {
        return {
          ok: false,
          model,
          durationMs,
          error: `Claude Code did not answer within ${Math.round((input.timeoutMs ?? 600_000) / 1000)} seconds.`,
        };
      }
      return {
        ok: false,
        model,
        durationMs,
        error: `Could not start Claude Code: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      // Only a directory this function made is one it may remove.
      if (owned) {
        await rm(workdir, { recursive: true, force: true }).catch(() => {});
      }
    }
  },
};
