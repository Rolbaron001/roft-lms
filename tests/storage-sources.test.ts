/**
 * Every column that holds a stored file, known to the scripts that move files.
 *
 * scripts/migrate-storage.mts copies the server's files into object storage,
 * and scripts/restore.sh checks a restored database's files are all there.
 * Each works from a list of columns. On 25 September the first list was found
 * naming three tables that do not exist and missing evidence_artifacts,
 * certificates and lessons: run for the off-site store, it would have moved
 * the library and left every learner's evidence behind.
 *
 * So the lists are checked against the schema itself. A storage column added
 * later fails here until the scripts know about it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";

function script(name: string): string {
  return readFileSync(join(process.cwd(), "scripts", name), "utf8");
}

/** table.column for every column whose name ends in storage_key. */
const inSchema = new Set<string>();
/** The tables whose files can leave in a cohort archive. */
const archivable = new Set<string>();

for (const value of Object.values(schema)) {
  if (!(value instanceof PgTable)) continue;
  const config = getTableConfig(value);
  for (const column of config.columns) {
    if (column.name.endsWith("storage_key")) inSchema.add(`${config.name}.${column.name}`);
    if (column.name === "archived_at") archivable.add(config.name);
  }
}

describe("the storage migration's list of sources", () => {
  const text = script("migrate-storage.mts");
  const listed = [
    ...text.matchAll(/\{ table: "([a-z_]+)", column: "([a-z_]+)"(, archived: true)? \}/g),
  ];

  it("names exactly the storage columns the schema has", () => {
    expect(new Set(listed.map(([, table, column]) => `${table}.${column}`))).toEqual(inSchema);
  });

  it("leaves out files that have gone to a cohort archive", () => {
    const marked = new Set(listed.filter((m) => m[3]).map(([, table]) => table));
    expect(marked).toEqual(archivable);
  });
});

describe("the restore check", () => {
  it("does not count an archived file as missing", () => {
    const text = script("restore.sh");
    for (const table of archivable) {
      if (table === "enrolment_documents") continue; // Not in the restore check's list.
      expect(text).toMatch(new RegExp(`from ${table}\\s+\\w+\\s+where storage_key is not null and \\(to_jsonb\\(\\w+\\) ->> 'archived_at'\\) is null`));
    }
  });
});
