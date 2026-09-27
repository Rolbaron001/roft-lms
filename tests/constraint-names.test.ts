/**
 * No constraint or index name longer than PostgreSQL keeps. Job sheet D5,
 * 27 September 2026.
 *
 * PostgreSQL cuts every name to 63 characters. The schema push then compares
 * the full name it generated with the cut one the database holds, finds them
 * different, and drops and re-adds the key on every deploy: sixteen foreign
 * keys, thirty-two statements, each re-checking a whole table under a lock.
 * Found in live's deploy log as a run of "will be truncated" notices.
 */
import { describe, expect, it } from "vitest";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

const LIMIT = 63;

const tables: PgTable[] = (Object.values(schema) as unknown[]).filter(
  (value): value is PgTable => value instanceof PgTable,
);

describe("names PostgreSQL will keep whole", () => {
  it("finds the tables", () => {
    expect(tables.length).toBeGreaterThan(100);
  });

  it("gives no foreign key a name over 63 characters", () => {
    const names = tables.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((key) => key.getName()),
    );
    // The generated names are read too, not only the ones written out: a
    // guard on the test, since reading none would pass.
    expect(names).toContain("statutory_notification_learners_notification_fk");
    expect(names.length).toBeGreaterThan(200);
    expect(names.filter((name) => name.length > LIMIT)).toEqual([]);
  });

  it("gives no index a name over 63 characters", () => {
    const long = tables.flatMap((table) =>
      getTableConfig(table)
        .indexes.map((index) => index.config.name ?? "")
        .filter((name) => name.length > LIMIT),
    );
    expect(long).toEqual([]);
  });
});
