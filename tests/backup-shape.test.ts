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
