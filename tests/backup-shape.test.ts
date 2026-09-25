/**
 * What a backup takes, and what it keeps.
 *
 * On 20 September 2026 the production disk reached 93% full with 1.4 GB free.
 * It was not the application's data: the database and every uploaded file came
 * to a little over 1 GB. It was 8.5 GB of backups, of which everything older
 * than seven days accounted for 0.08 GB.
 *
 * Two causes. A backup archives every uploaded file in full, which passed 1 GB
 * once the first qualification's material was in; and one is taken before
 * every deploy, so 19 September's eleven deploys cost 4 GB. Age-based
 * retention could not release any of it, because all the weight was from the
 * last three days.
 *
 * Both fixes live in shell scripts, which the rest of the suite cannot reach.
 * This reads them, the way tests/model-names-move.test.ts reads the extension
 * registry - not to check that bash is valid, but to stop the two decisions
 * below being undone by somebody who did not see the disk fill.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function script(name: string): string {
  return readFileSync(join(process.cwd(), "scripts", name), "utf8");
}

const backup = script("backup.sh");
const deploy = script("auto-deploy.sh");

/**
 * A setting the script reads is a setting that reaches it.
 *
 * backup.sh runs inside the tools container, and a container receives only the
 * variables its compose file names. BACKUP_KEEP_EVIDENCE and BACKUP_RETAIN_DAYS
 * were read by the script and named nowhere, so they were always their
 * defaults whatever .env said. Found on 25 September, when Roland chose two
 * evidence archives rather than three and .env alone would have kept three
 * without a word. Checked as a rule over every BACKUP_ setting the script
 * reads, so the next one added cannot be left out the same way.
 */
/**
 * The scheduled jobs can reach the world they send to.
 *
 * The tools container runs the nightly backup and the hourly notification
 * sender. It sat on the `internal` network alone, which has no route out, so it
 * could not resolve or reach mail.curiosa.academy: proved from that network on
 * 25 September. Every queued notification would have failed, and off-site
 * backups could never have run. The database, and only the database, belongs
 * on `internal` alone.
 */
describe("the scheduled jobs can reach beyond the server", () => {
  const compose = readFileSync(join(process.cwd(), "docker-compose.production.yml"), "utf8");

  /** One service's block, from its name at two spaces' indent to the next. */
  function service(name: string): string {
    const lines = compose.split("\n");
    const start = lines.findIndex((line) => line === `  ${name}:`);
    const end = lines.findIndex((line, i) => i > start && /^ {2}[a-z][\w-]*:\s*$|^\S/.test(line));
    return lines.slice(start, end === -1 ? undefined : end).join("\n");
  }

  it("puts the tools container on the network with a way out", () => {
    expect(service("tools")).toMatch(/networks:\n(?:\s+#.*\n)*\s+- edge\n\s+- internal/);
  });

  it("keeps the database off it", () => {
    const db = service("db");
    expect(db).toMatch(/- internal/);
    expect(db).not.toMatch(/- edge/);
  });

  it("keeps the no-route-out network for the database's sake", () => {
    expect(compose).toMatch(/internal:\n\s+internal: true/);
  });
});

describe("every backup setting reaches the backup", () => {
  const compose = readFileSync(join(process.cwd(), "docker-compose.production.yml"), "utf8");
  const read = [...backup.matchAll(/^(BACKUP_[A-Z_]+)=/gm)].map((match) => match[1]);

  it("finds the settings to check", () => {
    expect(read).toEqual(expect.arrayContaining(["BACKUP_KEEP_EVIDENCE", "BACKUP_RETAIN_DAYS"]));
  });

  it.each([...new Set(read)])("%s is passed to the tools container", (name) => {
    expect(compose, `${name} is read by backup.sh and never passed to it`).toMatch(
      new RegExp(`^\\s+${name}:`, "m"),
    );
  });
});

describe("the pre-deploy backup", () => {
  it("takes the database and not the evidence", () => {
    // The evidence half is ~1 GB; the database dump is under 1.5 MB, and it is
    // the only part that differs between two deploys ten minutes apart.
    expect(deploy).toMatch(/backup\.sh --local-only --database-only/);
  });

  it("still exists, because a deploy without one is worse", () => {
    // Cheap now that it is the database alone, so there is no reason to drop
    // it - and a migration that goes wrong with no copy taken is the failure
    // this whole step is for.
    expect(deploy).toMatch(/Taking a database copy first/);
  });
});

describe("backup.sh with --database-only", () => {
  it("is an option it actually parses", () => {
    expect(backup).toMatch(/--database-only\) DATABASE_ONLY="yes"/);
  });

  it("says out loud that the evidence was not archived", () => {
    // A backup that silently covers half of what the name implies is the
    // failure mode this script is written against. It must announce it.
    expect(backup).toMatch(/evidence files were NOT archived by this run/);
  });

  it("does not leave EV_BYTES unset for the size check", () => {
    // set -u is on. An unset EV_BYTES in the 2 GB warning would abort the
    // whole run - after the dump and before the prune.
    expect(backup).toMatch(/^EV_BYTES=0$/m);
    expect(backup).toMatch(
      /if \[\[ "\$DATABASE_ONLY" == "no" && "\$STORAGE_DRIVER" == "local" \]\]/,
    );
  });
});

describe("what pruning keeps", () => {
  it("keeps evidence archives by count, not by age", () => {
    // Age released 0.08 GB out of 8.5. The unit has to be copies.
    expect(backup).toMatch(/BACKUP_KEEP_EVIDENCE="\$\{BACKUP_KEEP_EVIDENCE:-3\}"/);
    expect(backup).toMatch(/ls -1t "\$BACKUP_DIR"\/roft-lms-\*\.evidence\.tar\.gz\.enc/);
  });

  it("still prunes database dumps by age", () => {
    // They are tiny - 58 of them came to 0.04 GB - so a month of history is
    // nearly free and worth keeping.
    expect(backup).toMatch(/-name 'roft-lms-\*\.dump\.enc'/);
    expect(backup).toMatch(/-mtime "\+\$\{BACKUP_RETAIN_DAYS\}" -print -delete/);
  });

  it("does not prune evidence by age as well", () => {
    // The original find matched both halves in one expression. Leaving that in
    // place beside the count-based prune would quietly re-impose the rule the
    // count exists to replace.
    expect(backup).not.toMatch(
      /-name 'roft-lms-\*\.dump\.enc' -o -name 'roft-lms-\*\.evidence/,
    );
  });

  it("writes down why a dump may now outlive its evidence", () => {
    /*
     * This reverses a rule the script previously stated and defended, so the
     * reasoning has to travel with it: the evidence store is append-only, so
     * the newest archive contains everything an older dump refers to. Somebody
     * who finds a ten-day-old dump and a three-day-old archive needs to know
     * that was a decision.
     */
    expect(backup).toMatch(/append-only/);
  });
});

/**
 * The same lesson, one layer down.
 *
 * The backups above were kept by age, and age released nothing because the
 * churn was faster than the window. On 21 September 2026 the images did it
 * again: six deploys in a day, 2.33 GB each (972 MB of app image and 1.36 GB
 * of tools image), all of them inside a 72-hour retention. The prune printed
 * "Total reclaimed space: 0B" after every one while 4.6 GB of unused images
 * sat on a 19 GB disk.
 *
 * The comment defending three days had done the arithmetic for one deploy a
 * day. A development day is not one deploy.
 *
 * Then, on 24 September, the count itself turned out never to have run. Its
 * filter looked for "roft-lms" in a line holding only a date and a commit
 * hash, matched nothing, and under `set -euo pipefail` stopped the deploy
 * before it removed a single image: 16 images and 84% full. The same day a
 * development site started running ahead of live, and "the newest two" stopped
 * being a safe rule, because both could be development's. The rule is now
 * "whatever is running or pinned", shared by both sites in
 * scripts/prune-images.sh. What these tests protect has not changed; where it
 * lives has.
 */
describe("how many image versions the server keeps", () => {
  const prune = readFileSync(join(process.cwd(), "scripts/prune-images.sh"), "utf8");

  it("keeps by what is needed, never by age", () => {
    expect(deploy).toMatch(/scripts\/prune-images\.sh/);
    expect(prune).toMatch(/docker ps -a/);
    // The age filter that could not release anything is gone, and stays gone:
    // leaving it anywhere would re-impose the rule it failed at.
    for (const script of [deploy, prune]) {
      expect(script).not.toMatch(/--filter "?until=/);
    }
  });

  it("keeps each version as a pair", () => {
    /*
     * The app image carries the code and the tools image carries the
     * migrations, and they share a commit tag. Keeping an app image whose
     * tools image had been removed would leave a rollback able to start and
     * unable to migrate - which is the failure this script's own comments
     * describe as the worst outcome, because the site comes up healthy against
     * the wrong schema.
     *
     * Kept as a pair because the keep-list is of tags, and the removal checks
     * every app and every tools image against the same list.
     */
    expect(prune).toMatch(/roft-lms-\(app\|tools\):/);
    expect(prune).toMatch(/grep -qx "\$TAG"/);
  });

  it("still clears dangling layers, which have no version at all", () => {
    expect(prune).toMatch(/docker image prune -f/);
    expect(deploy).toMatch(/docker builder prune -af/);
  });

  it("tells somebody the right command when the disk is already full", () => {
    // First it named a filter that could not help. Then it named
    // `docker image prune -af`, which removes every image without a running
    // container, and between deploys that is the tools image live's nightly
    // backup runs in. The right command keeps what is running or pinned.
    expect(deploy).not.toMatch(/prune -af --filter until=72h/);
    expect(deploy).not.toMatch(/Reclaim space first: 'docker image prune -af'/);
    expect(deploy).toMatch(/Reclaim space first with '\.\/scripts\/prune-images\.sh --dry-run'/);
  });
});

describe("cohort archives waiting on the server", () => {
  it("are left out of the evidence backup, which already holds every byte of them", () => {
    // A built archive waits in the storage volume until the provider checks
    // their copy. It is a copy of evidence the same backup already takes, and
    // taking it again would double the evidence on a disk with none to spare.
    const archive = readFileSync(join(process.cwd(), "lib", "cohort-archive.ts"), "utf8");
    expect(archive).toMatch(/process\.env\.STORAGE_LOCAL_ROOT \?\? "storage", "_archives"/);
    expect(backup).toMatch(/tar -czf "\$EVIDENCE_TAR" --exclude=\.\/_archives -C "\$STORAGE_ROOT" \./);
    expect(backup).toMatch(/-path "\$STORAGE_ROOT\/_archives" -prune/);
  });
});
