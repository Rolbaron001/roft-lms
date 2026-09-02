/**
 * Moves everything already on the server's disk into object storage.
 *
 * Flipping STORAGE_DRIVER to s3 sends *new* uploads to the bucket and leaves
 * every existing file where it is. That is the gap this closes, and without it
 * the switch quietly produces the worst of both: half the evidence in a
 * replicated bucket and half on a single disk, with nothing saying which.
 *
 * Rules it follows, in order of how much they matter:
 *
 *   1. It never deletes the local copy. Removing the originals is a separate,
 *      deliberate act taken after somebody has looked at the report, because
 *      the failure mode of getting this wrong is unrecoverable.
 *
 *   2. It verifies. Every upload is read back and hashed against the bytes
 *      that went up. An upload that silently truncated is worse than one that
 *      failed, because the failure is visible.
 *
 *   3. It is safe to run twice. A key already present and matching is counted
 *      and skipped, so an interrupted run is resumed by running it again.
 *
 *   4. It reports rather than reassures. Anything missing from disk is listed
 *      by key, because a database row pointing at a file that is not there is
 *      a finding in itself and one that predates this script.
 *
 * Usage, on the machine holding the files:
 *
 *   npx tsx scripts/migrate-storage.mts            # dry run, changes nothing
 *   npx tsx scripts/migrate-storage.mts --apply    # uploads and verifies
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const LOCAL_ROOT = resolve(process.env.STORAGE_LOCAL_ROOT ?? "storage");

/**
 * Every column that holds a key, with the table it is on.
 *
 * Listed rather than discovered. A column added later and not added here would
 * be missed silently, and a list somebody has to update is at least a list
 * somebody can read - which a clever query over the catalogue is not.
 */
const SOURCES: { table: string; column: string }[] = [
  { table: "assessment_evidence", column: "storage_key" },
  { table: "assessment_papers", column: "storage_key" },
  { table: "programme_documents", column: "storage_key" },
  { table: "qualification_documents", column: "storage_key" },
  { table: "capture_jobs", column: "paper_storage_key" },
  { table: "capture_jobs", column: "guide_storage_key" },
  { table: "enrolment_documents", column: "storage_key" },
  { table: "library_documents", column: "storage_key" },
  { table: "organisations", column: "logo_storage_key" },
  { table: "mail_attachments", column: "storage_key" },
];

async function main() {
  if (process.env.STORAGE_DRIVER !== "s3") {
    console.error(
      "STORAGE_DRIVER is not set to s3. Set it, with the bucket settings, before running this - otherwise there is nowhere to copy to.",
    );
    process.exit(1);
  }

  const { putObject, getObject } = await import("../lib/storage");

  const sql = postgres(process.env.DATABASE_ADMIN_URL!);
  const keys = new Set<string>();
  const skippedTables: string[] = [];

  try {
    for (const source of SOURCES) {
      let rows: { key: string | null }[];
      try {
        rows = await sql.unsafe(
          `select "${source.column}" as key from "${source.table}" where "${source.column}" is not null`,
        );
      } catch {
        // A table this build does not have. Recorded rather than ignored: the
        // list above is the thing a reader trusts, so a gap in it must show.
        skippedTables.push(`${source.table}.${source.column}`);
        continue;
      }
      for (const row of rows) {
        if (row.key) keys.add(row.key);
      }
    }
  } finally {
    await sql.end();
  }

  console.log(`${keys.size} distinct files referenced by the database.`);
  if (skippedTables.length > 0) {
    console.log(`Not present in this build: ${skippedTables.join(", ")}`);
  }
  if (!APPLY) {
    console.log("\nDry run. Nothing was copied. Add --apply to do it.");
  }

  let copied = 0;
  let already = 0;
  const missing: string[] = [];
  const failed: string[] = [];

  for (const key of [...keys].sort()) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(join(LOCAL_ROOT, key)));
    } catch {
      missing.push(key);
      continue;
    }

    const expected = createHash("sha256").update(bytes).digest("hex");

    // Already there and matching: an interrupted run resumes by rerunning.
    try {
      const existing = await getObject(key);
      const found = createHash("sha256")
        .update(existing)
        .digest("hex");
      if (found === expected) {
        already += 1;
        continue;
      }
    } catch {
      /* not in the bucket yet, which is the ordinary case */
    }

    if (!APPLY) {
      copied += 1;
      continue;
    }

    try {
      await putObject(key, bytes, "application/octet-stream");
      const back = await getObject(key);
      const verified = createHash("sha256").update(back).digest("hex");

      if (verified !== expected) {
        failed.push(`${key} (uploaded, but read back different)`);
        continue;
      }
      copied += 1;
    } catch (error) {
      failed.push(
        `${key} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  console.log(
    `\n${APPLY ? "Copied" : "Would copy"}: ${copied}. Already there: ${already}.`,
  );

  if (missing.length > 0) {
    console.log(
      `\n${missing.length} referenced by the database and not on disk. This predates the migration and is worth looking at:`,
    );
    for (const key of missing.slice(0, 50)) console.log(`  ${key}`);
    if (missing.length > 50) console.log(`  ...and ${missing.length - 50} more`);
  }

  if (failed.length > 0) {
    console.log(`\n${failed.length} failed:`);
    for (const line of failed) console.log(`  ${line}`);
    process.exitCode = 1;
  }

  if (APPLY && failed.length === 0 && missing.length === 0) {
    console.log(
      "\nEvery file is in the bucket and verified. The local copies are still there and have deliberately not been touched - delete them only once you are satisfied, and take a backup first.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
