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
 *   - It does not work on the production server, where nobody is signed in and
 *     the application runs in a container. There the provider reports itself
 *     unavailable and the platform behaves exactly as it does today.
 *
 * That second point is not a limitation to be engineered around. Signing a
 * personal subscription into a multi-tenant server would put one person's
 * usage limits behind every tenant's work and is a licensing question rather
 * than a technical one. The honest shape is a provider that is available where
 * somebody is signed in and absent where nobody is.
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
export function signedIn(): boolean {
  const home =
    process.env.CLAUDE_CONFIG_DIR ??
    (process.env.HOME ? join(process.env.HOME, ".claude") : null);

  if (!home) return true;

  for (const marker of [".credentials.json", "credentials.json"]) {
    if (existsSync(join(home, marker))) return true;
  }

  // Some installations keep it beside the directory rather than inside it.
  if (process.env.HOME && existsSync(join(process.env.HOME, ".claude.json"))) {
    return true;
  }

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
  return message.trim() || "Claude Code reported an error.";
}

export const claudeCodeProvider: AiProvider = {
  name: "claude_code",
  label: "Claude Code (subscription)",
  description:
    "Uses the Claude subscription signed in on the machine running the platform. No API key and no per-token cost. Unavailable on the server, where nobody is signed in.",
  defaultModel: "claude-opus-5",

  availability(): Availability {
    const cli = findClaudeCli();
    if (!cli) {
      return {
        available: false,
        reason:
          "Claude Code is not installed where the platform is running.",
        remedy:
          "On the hosted platform it is installed already, so seeing this means something is wrong with the deployment rather than with your account - tell whoever maintains it. Running the platform on your own machine, install Claude Code there.",
      };
    }

    // Installed but nobody has signed in. Distinguished from not installed at
    // all because the two need completely different things done about them,
    // and the earlier message ran them together - it told somebody to install
    // software that was already there.
    if (!signedIn()) {
      return {
        available: false,
        reason: "Nobody has signed in to Claude on this platform yet.",
        remedy:
          "This is a one-time step and it needs somebody with a Claude subscription to do it, because it means authenticating that subscription. Whoever maintains the platform runs `claude` on the server and follows the /login prompt. Note that a single sign-in serves the whole platform: everyone's AI use draws on that one subscription and its limits, because Claude Code holds one sign-in per machine rather than one per person.",
        detail: cli,
      };
    }

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
        const child = spawn(command, args, {
          cwd: workdir,
          windowsHide: true,
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
