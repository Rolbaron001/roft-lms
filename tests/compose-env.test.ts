/**
 * Every setting the application reads reaches the container that runs it.
 *
 * Roland registered the Google OAuth application on 18 September, put the
 * client ID and secret into the server's .env, restarted, and the Settings
 * page still said "no file store is set up on this deployment". Nothing was
 * wrong with what he did. The compose file names each variable the app
 * container receives, one at a time, and the two drive variables were not on
 * that list - so the process started without them and the provider reported
 * itself unconfigured, exactly as it should have.
 *
 * That is the shape of the fault worth guarding. It is silent by construction:
 * the value is present on the server, correct, and readable, and the feature
 * behaves as though it were never set. There is nothing to see in a log, and
 * the person who set it up is pointed at their own work rather than at the
 * wiring. DATABASE_POOL_MAX had been sitting in the same state, documented and
 * doing nothing, for long enough that nobody had noticed.
 *
 * So: anything the code reads from the environment, and that .env.example
 * tells an operator to set, has to be named in the app service. Reading both
 * ends rather than keeping a third list, because a third list is what fails
 * next.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const compose = readFileSync(
  join(root, "docker-compose.production.yml"),
  "utf8",
);
const example = readFileSync(join(root, ".env.example"), "utf8");

/** The environment block of one service, up to the next key at its indent. */
function environmentOf(service: string): string {
  const start = compose.indexOf(`\n  ${service}:`);
  if (start < 0) throw new Error(`no ${service} service in the compose file`);

  const after = compose.slice(start + 1);
  const end = after.search(/\n  [a-z_-]+:\n/);
  const block = end < 0 ? after : after.slice(0, end);

  const env = block.indexOf("\n    environment:");
  if (env < 0) return "";

  const rest = block.slice(env + 1);
  const stop = rest.search(/\n    [a-z_]+:/);
  return stop < 0 ? rest : rest.slice(0, stop);
}

/** What an operator is told to set. */
function documented(): Set<string> {
  return new Set(
    Array.from(example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)).map(
      (match) => match[1],
    ),
  );
}

/**
 * What the running application reads. Taken from the source rather than
 * assumed: git grep so the build output under .next is not counted twice.
 */
function readFromEnvironment(): Set<string> {
  const found = execFileSync(
    "git",
    ["grep", "-hoE", String.raw`process\.env\.[A-Z][A-Z0-9_]*`, "--", "app", "lib", "db", "components"],
    { cwd: root, encoding: "utf8" },
  );

  return new Set(
    found
      .split("\n")
      .filter(Boolean)
      .map((one) => one.replace("process.env.", "")),
  );
}

describe("the production compose file", () => {
  it("passes the app everything it reads and an operator is told to set", () => {
    const block = environmentOf("app");
    const wanted = [...readFromEnvironment()].filter((name) =>
      documented().has(name),
    );

    const missing = wanted.filter(
      (name) => !new RegExp(`^      ${name}:`, "m").test(block),
    );

    expect(missing).toEqual([]);
  });

  /**
   * A variable read as a number must not arrive as the empty string. `?? 10`
   * keeps "" and asks Postgres for a pool of nought connections, which fails
   * at the first query rather than at startup.
   */
  it("gives a default to settings it does not require", () => {
    const block = environmentOf("app");
    const numeric = Array.from(
      block.matchAll(/^      ([A-Z][A-Z0-9_]*(?:_MAX|_PORT|_SIZE|_LIMIT)):/gm),
    ).map((match) => match[1]);

    for (const name of numeric) {
      const line = new RegExp(`^      ${name}: \\$\\{${name}:-(.*)\\}`, "m");
      const value = line.exec(block)?.[1];
      // Either required outright, or defaulted to something a number can be
      // made of. An empty default is the one thing it must not be.
      if (value !== undefined) expect(value).not.toBe("");
    }
  });

  /** The drive credentials specifically, since this is what they cost. */
  it("passes the drive credentials", () => {
    const block = environmentOf("app");

    for (const name of [
      "GOOGLE_DRIVE_CLIENT_ID",
      "GOOGLE_DRIVE_CLIENT_SECRET",
      "ONE_DRIVE_CLIENT_ID",
      "ONE_DRIVE_CLIENT_SECRET",
    ]) {
      expect(block).toContain(`${name}: \${${name}`);
    }
  });
});
