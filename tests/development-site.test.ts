/**
 * The development site, and the rules that keep it from touching live.
 *
 * Decided on 23 September 2026, at Linda's recommendation, after changes had
 * gone straight to live all week; built on 24 September. A second copy of the
 * application runs beside live on the same server, and live takes the version
 * that ran there on Friday night.
 *
 * Everything here is infrastructure that cannot be exercised in a unit test,
 * so it is held the way tests/backup-shape.test.ts holds the backup: by reading
 * the files for the properties that matter. Each property below was either a
 * decision Roland took or a fault found while building this, and each is the
 * kind of thing a later edit could quietly undo.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deploymentLabel } from "@/components/deployment-banner";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Shell and YAML with their comments removed, so prose cannot satisfy a test. */
function code(path: string): string {
  return source(path)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const devCompose = code("docker-compose.development.yml");
const liveCompose = code("docker-compose.production.yml");
const caddyfile = code("Caddyfile");

/**
 * One service's block, found by its name at the start of a line.
 *
 * A plain search for "  db:" first found the `db:` under the app's own
 * `depends_on`, which cut the app's block short and started the database's in
 * the wrong place. Anchored to exactly two spaces of indentation it cannot.
 */
function service(yaml: string, name: string): string {
  const start = yaml.search(new RegExp(`^ {2}${name}:\\s*$`, "m"));
  const rest = yaml.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$|^\S/m);
  return next === -1 ? yaml.slice(start) : yaml.slice(start, start + 1 + next);
}

const devAppEnv = service(devCompose, "app");

describe("the development site holds nothing of live's", () => {
  it("has its own database, not live's", () => {
    expect(devCompose).toMatch(/^\s{2}db:\s*$/m);
    expect(devAppEnv).toMatch(/@db:5432/);
    // The block really is the app's, down to its networks: a guard on the
    // test itself, since a short slice would pass the absence checks below
    // without having looked at the whole block.
    expect(devAppEnv).toMatch(/NODE_OPTIONS/);
    expect(devAppEnv).toMatch(/aliases:/);
    // Its own compose project, which is what names its volumes apart.
    expect(devCompose).toMatch(/^name: roft-lms-dev$/m);
    expect(devCompose).not.toMatch(/roft-lms_pgdata|roft-lms_evidence/);
  });

  it("never runs `latest`", () => {
    // CI publishes `latest` on every build. A site that ran it would take
    // untried code without anybody choosing to.
    expect(devCompose).toMatch(/roft-lms-app:\$\{IMAGE_TAG:\?/);
    expect(devCompose).toMatch(/roft-lms-tools:\$\{IMAGE_TAG:\?/);
    expect(devCompose).not.toMatch(/:-latest/);
  });

  it("cannot send mail, reach a drive or open anybody's AI token", () => {
    // A straight copy of live holds real staff email addresses.
    for (const name of ["MAIL_", "GOOGLE_DRIVE_", "ONE_DRIVE_", "AI_TOKEN_KEY", "S3_"]) {
      expect(devAppEnv, `${name} passed to the development app`).not.toContain(name);
    }
  });

  it("says what it is on every page", () => {
    expect(devAppEnv).toMatch(/DEPLOYMENT_LABEL: Development/);
    expect(liveCompose).not.toMatch(/DEPLOYMENT_LABEL/);
  });

  it("is capped so it cannot starve live", () => {
    // One processor and 929 MB between two sites. Live has no cap; this does.
    const caps = devCompose.match(/cpus: [0-9.]+/g) ?? [];
    expect(devCompose.match(/mem_limit:/g)).toHaveLength(3);
    const running = caps.slice(0, 2).map((c) => Number(c.split(" ")[1]));
    // App and database together leave live at least 40 per cent. Compared
    // with a tolerance, because 0.4 + 0.2 is 0.6000000000000001 in floating
    // point.
    expect(running.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(0.6 + 1e-9);
    // Node would size its heap from the machine and overrun the cap.
    expect(devAppEnv).toMatch(/--max-old-space-size=/);
  });

  it("reaches the proxy over live's network and nothing else of live's", () => {
    expect(devCompose).toMatch(/name: roft-lms_edge/);
    expect(devCompose).toMatch(/external: true/);
    expect(devCompose).toMatch(/- app-dev/);
    // The database is internal only.
    const db = service(devCompose, "db");
    expect(db).toMatch(/postgres:18-alpine/);
    expect(db).not.toMatch(/edge/);
  });
});

describe("the proxy is shared without naming anybody's host", () => {
  it("names no operator's development address", () => {
    // The Caddyfile is shared by every deployment of the platform.
    expect(caddyfile).not.toMatch(/roftbusiness\.org/);
  });

  it("imports a server's own sites from a folder that may be empty", () => {
    // Checked against Caddy v2.11.4 on 24 September: valid missing, empty
    // and populated.
    expect(caddyfile).toMatch(/import \/etc\/caddy\/sites\/\*\.caddy/);
    expect(liveCompose).toMatch(/\.\/caddy-sites:\/etc\/caddy\/sites:ro/);
    expect(source("caddy-sites/.gitignore")).toMatch(/^\*\.caddy$/m);
  });

  it("uses one snippet for both sites, so their headers cannot drift", () => {
    expect(caddyfile).toMatch(/reverse_proxy \{args\[0\]\}/);
    expect(caddyfile.match(/import lms app:3000/g)).toHaveLength(2);
  });
});

describe("live is released only on purpose", () => {
  const deploy = code("scripts/auto-deploy.sh");
  const promote = code("scripts/promote-to-production.sh");

  it("can release a particular commit, and only one already on main", () => {
    expect(deploy).toMatch(/--to\)/);
    expect(deploy).toMatch(/merge-base --is-ancestor "\$REMOTE" "origin\/\$BRANCH"/);
    expect(deploy).toMatch(/merge --ff-only --quiet "\$REMOTE"/);
  });

  it("keeps the commit it was given when it reloads itself", () => {
    // Without this the reloaded script would deploy the newest commit.
    expect(deploy).toMatch(/exec "\$REPO\/scripts\/auto-deploy\.sh" --force --to "\$REMOTE"/);
  });

  it("promotes a version development ran, not the newest commit", () => {
    expect(promote).toMatch(/scripts\/soaked-version\.sh" "\$DEV_LOG" "\$MIN_SOAK_HOURS"/);
    expect(promote).toMatch(/auto-deploy\.sh" --to "\$TAG"/);
    expect(promote).not.toMatch(/origin\/main/);
  });

  it("will not promote an unhealthy or untried development site", () => {
    expect(promote).toMatch(/api\/health/);
    expect(promote).toMatch(/MIN_SOAK_HOURS/);
    expect(promote).toMatch(/--now\) NOW=true/);
  });

  it("never takes live backwards", () => {
    // After a --now release live can be ahead of everything that has soaked.
    expect(promote).toMatch(/merge-base --is-ancestor "\$TAG" "\$LIVE_TAG"/);
  });

  it("waits its turn rather than giving up the week's release", () => {
    expect(deploy).toMatch(/exit 75/);
    expect(promote).toMatch(/-ne 75/);
  });

  it("pins live's scheduled jobs to what it deployed", () => {
    // Otherwise the backup runs `latest`, which is development's untried code.
    expect(deploy).toMatch(/IMAGE_TAG=\$\{IMAGE_TAG\}/);
  });

  it("no longer tells anybody to run the command that deletes live's tools image", () => {
    expect(source("scripts/auto-deploy.sh")).not.toMatch(/Reclaim space first: 'docker image prune -af'/);
  });

  it("does not treat a slow but healthy deploy as a crash", () => {
    // Twenty minutes, while a deploy may wait thirty for its images.
    expect(deploy).toMatch(/STALE_MINUTES=45/);
    expect(code("scripts/deploy-development.sh")).toMatch(/STALE_MINUTES=45/);
  });
});

/**
 * Which version Friday releases. Job sheet B2, 27 September 2026.
 *
 * The first rule looked only at what development ran at 22:00, so a push late
 * on a Friday held back the whole week. These run the selector itself against
 * a log in the shape the server writes, including the "X -> X" line every
 * deploy adds when it reloads itself, which the server's own log showed.
 */
describe("Friday releases the newest version development ran long enough", () => {
  /**
   * Bash as the server has it. On Windows, `bash` on the PATH is usually the
   * WSL launcher, so Git's own is used, found from git itself.
   */
  function bash(): string | null {
    if (process.platform !== "win32") return "bash";
    const gitExec = execSync("git --exec-path", { encoding: "utf8" }).trim();
    const candidate = join(gitExec, "..", "..", "..", "bin", "bash.exe");
    return existsSync(candidate) ? candidate : null;
  }
  const shell = bash();

  const log = [
    "[2026-09-21 08:00:00Z] Development healthy at https://dev.example.test on aaaaaaa.",
    "[2026-09-23 09:00:00Z] Development aaaaaaa -> bbbbbbb: Something from Wednesday",
    "[2026-09-23 09:00:06Z] Development bbbbbbb -> bbbbbbb: Something from Wednesday",
    "[2026-09-23 09:03:00Z] Development healthy at https://dev.example.test on bbbbbbb.",
    "[2026-09-23 09:04:00Z] Development deployed bbbbbbb.",
    "[2026-09-25 17:00:00Z] Development bbbbbbb -> ccccccc: Late on Friday",
    "[2026-09-25 17:00:06Z] Development ccccccc -> ccccccc: Late on Friday",
    "[2026-09-25 17:03:00Z] Development healthy at https://dev.example.test on ccccccc.",
  ].join("\n");

  function soaked(at: string, hours = 6): string {
    const dir = mkdtempSync(join(tmpdir(), "soak-"));
    const path = join(dir, "development-deploy.log");
    writeFileSync(path, `${log}\n`);
    try {
      return execFileSync(shell!, ["scripts/soaked-version.sh", path.replace(/\\/g, "/"), String(hours)], {
        encoding: "utf8",
        env: { ...process.env, NOW_EPOCH: String(Date.parse(at) / 1000) },
      }).trim();
    } catch {
      return "none";
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.skipIf(!shell)("releases the week's work when a late push has not had its hours", () => {
    // 22:00 SAST is 20:00 UTC; ccccccc has run three hours, bbbbbbb ran two days.
    expect(soaked("2026-09-25T20:00:00Z")).toBe("bbbbbbb 55");
  });

  it.skipIf(!shell)("releases the late push once it has had them", () => {
    expect(soaked("2026-09-25T23:10:00Z")).toBe("ccccccc 6");
  });

  it.skipIf(!shell)("does not count a deploy reloading itself as a change of version", () => {
    // Were "ccccccc -> ccccccc" an end, ccccccc would never be seen to run.
    expect(soaked("2026-09-26T20:00:00Z")).toBe("ccccccc 26");
  });

  it.skipIf(!shell)("releases nothing when nothing has run long enough", () => {
    expect(soaked("2026-09-21T10:00:00Z", 6)).toBe("none");
  });
});

describe("the two deploys cannot interfere", () => {
  const dev = code("scripts/deploy-development.sh");

  it("share one lock", () => {
    expect(dev).toMatch(/LOCKDIR="\/tmp\/roft-lms-deploy\.lock\.d"/);
    expect(code("scripts/auto-deploy.sh")).toMatch(/LOCKDIR="\/tmp\/roft-lms-deploy\.lock\.d"/);
  });

  it("refuses to run the development deploy against live", () => {
    expect(dev).toMatch(/grep -qx 'SITE=development' \.env/);
    expect(dev).not.toMatch(/docker-compose\.production\.yml/);
  });

  it("makes room from its own previous version, never live's", () => {
    expect(dev).toMatch(/"\$PREVIOUS" != "\$LIVE_TAG"/);
  });
});

describe("tidying images keeps what is running or pinned", () => {
  const prune = code("scripts/prune-images.sh");

  it("keeps images in use and pinned versions", () => {
    expect(prune).toMatch(/docker ps -a/);
    expect(prune).toMatch(/pinned "\$LIVE_ENV"/);
    expect(prune).toMatch(/pinned "\$DEV_ENV"/);
  });

  it("does not keep `latest` for its own sake", () => {
    // On 25 September `latest` pointed at a version nothing ran, and keeping
    // it held back the development site's next update on a full disk. Live
    // pins its version in .env, so nothing needs the tag.
    expect(prune).not.toMatch(/\\nlatest\\n|grep -vx latest/);
    expect(prune).toMatch(/KEEP=\$\(printf '%s\\n%s\\n%s\\n' "\$IN_USE"/);
  });

  it("removes nothing when it cannot tell what is in use", () => {
    expect(prune).toMatch(/none were removed/);
  });

  it("is what both deploys call", () => {
    expect(code("scripts/auto-deploy.sh")).toMatch(/scripts\/prune-images\.sh/);
    expect(code("scripts/deploy-development.sh")).toMatch(/scripts\/prune-images\.sh/);
  });
});

describe("setting it up", () => {
  const setup = code("scripts/setup-development.sh");

  it("never prints a secret", () => {
    // Generated straight into the .env; the values never reach the log.
    expect(setup).toMatch(/umask 077/);
    expect(setup).toMatch(/chmod 600 "\$DEV\/\.env"/);
    for (const line of setup.split("\n").filter((l) => /\blog\b/.test(l))) {
      expect(line).not.toMatch(/PASSWORD|AUTH_SECRET|\$\(secret\)/);
    }
  });

  it("uses secrets that are safe inside a database URL", () => {
    expect(setup).toMatch(/od -An -tx1/);
  });

  it("only reads from live's database and files", () => {
    expect(setup).toMatch(/live exec -T db pg_dump/);
    expect(setup).toMatch(/roft-lms_evidence:\/from:ro/);
    expect(setup).not.toMatch(/live exec -T db psql[^\n]*(delete|update|drop|insert)/i);
  });

  it("carries the data across and not people's live access", () => {
    expect(setup).toMatch(/delete from sessions/);
    expect(setup).toMatch(/update ai_user_settings set token_sealed = null/);
    expect(setup).toMatch(/delete from drive_connections/);
  });

  it("checks the copy is complete rather than assuming it", () => {
    expect(setup).toMatch(/The copy is incomplete/);
  });

  it("validates the proxy before reloading it, and backs out if either fails", () => {
    const validate = setup.indexOf("caddy validate");
    const reload = setup.indexOf("caddy reload");
    expect(validate).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(validate);
    expect(setup.match(/rm -f "\$SITE_FILE"/g)).toHaveLength(2);
  });

  it("checks live is still up once the development site is", () => {
    expect(setup).toMatch(/LIVE IS NOT ANSWERING/);
  });
});

describe("changing the schedule", () => {
  const schedule = code("scripts/schedule-development.sh");

  it("never pipes straight into crontab", () => {
    // A pipe that failed part-way would install whatever had arrived.
    expect(schedule).not.toMatch(/\|\s*crontab\s+-/);
    expect(schedule).toMatch(/crontab "\$AFTER"/);
  });

  it("refuses to install a schedule that has lost a job", () => {
    expect(schedule).toMatch(/grep -qxF "\$line" "\$AFTER"/);
  });

  it("removes the old release's explanation along with it", () => {
    // Found by a dry run against the server's real crontab: removing only
    // lines naming the script left "To deploy sooner, run it by hand:" alone.
    expect(schedule).toMatch(/comments = ""; next/);
  });

  it("can show the change without making it", () => {
    expect(schedule).toMatch(/diff "\$BEFORE" "\$AFTER"/);
  });
});

/**
 * Every shell script is committed executable.
 *
 * Git on Windows does not see the executable bit, so a script created there is
 * committed as an ordinary file and the Linux server refuses to run it. All
 * five scripts for the development site went up that way on 25 September: cron
 * would have failed with "Permission denied" every fifteen minutes, setup would
 * not have started, and live's deploy would have skipped its tidying. Caught by
 * looking at the index before the server pulled, which a later script will not
 * be lucky enough to get.
 */
describe("the server can run the scripts", () => {
  it("records every shell script as executable", () => {
    const index = execSync("git ls-files -s -- scripts", { encoding: "utf8" });
    const scripts = index
      .split("\n")
      .filter((line) => line.trim().endsWith(".sh"))
      .map((line) => ({ mode: line.split(/\s+/)[0], path: line.split("\t")[1] }));

    expect(scripts.length).toBeGreaterThan(5);
    for (const script of scripts) {
      expect(script.mode, `${script.path} is not executable: git update-index --chmod=+x ${script.path}`).toBe("100755");
    }
  });
});

describe("the banner", () => {
  it("is off unless the site is labelled", () => {
    expect(deploymentLabel({})).toBeNull();
    expect(deploymentLabel({ DEPLOYMENT_LABEL: "" })).toBeNull();
    expect(deploymentLabel({ DEPLOYMENT_LABEL: "   " })).toBeNull();
  });

  it("carries the label it is given", () => {
    expect(deploymentLabel({ DEPLOYMENT_LABEL: "Development" })).toBe("Development");
  });

  it("appears on the sign-in page as well as every page inside", () => {
    // The sign-in page is where a mistake between the two sites would start.
    expect(source("app/login/page.tsx")).toMatch(/<DeploymentBanner \/>/);
    expect(source("components/app-shell.tsx")).toMatch(/<DeploymentBanner \/>/);
  });

  it("uses no em dashes", () => {
    expect(source("components/deployment-banner.tsx")).not.toMatch(/—|&mdash;/);
  });
});
