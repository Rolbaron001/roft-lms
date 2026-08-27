/**
 * Renames that have to happen before the schema is pushed.
 *
 * `drizzle-kit push` compares the schema against the database and has no way
 * to know that a column which disappeared and one that appeared are the same
 * column under a new name. Left to itself it drops the old one and creates the
 * new one empty — which loses every value in it, silently, on a database that
 * has already been backed up minutes earlier and looks fine afterwards.
 *
 * So renames are done here, explicitly, before the push runs. Everything below
 * is idempotent: it checks the current state and does nothing if the rename has
 * already happened, because this runs on every deploy.
 *
 *   npx tsx scripts/pre-migrate.ts
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const adminUrl = process.env.DATABASE_ADMIN_URL;

if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL is not set. See .env.example.");
  process.exit(1);
}

type Rename = {
  table: string;
  from: string;
  to: string;
  /** Indexes carrying the old name, renamed with it so they stay readable. */
  indexes?: { from: string; to: string }[];
  why: string;
};

const RENAMES: Rename[] = [
  {
    table: "qualifications",
    from: "qcto_code",
    to: "curriculum_code",
    indexes: [
      {
        from: "qualifications_org_qcto_code_idx",
        to: "qualifications_org_curriculum_code_idx",
      },
    ],
    why: "The curriculum document heads that column \"Curriculum Code\"; the QCTO does not own the field.",
  },
];

async function main() {
  const sql = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  let applied = 0;

  try {
    for (const rename of RENAMES) {
      const [column] = await sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = ${rename.table}
            and column_name = ${rename.from}
        ) as exists
      `;

      const [already] = await sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = ${rename.table}
            and column_name = ${rename.to}
        ) as exists
      `;

      if (already.exists) {
        // Done on an earlier deploy. Nothing to say: this is the normal state.
        continue;
      }

      if (!column.exists) {
        // Neither name is present, so this is a fresh database and the push
        // will create the column under its new name. Also normal.
        continue;
      }

      console.log(
        `Renaming ${rename.table}.${rename.from} to ${rename.to}\n  ${rename.why}`,
      );

      await sql.unsafe(
        `alter table "${rename.table}" rename column "${rename.from}" to "${rename.to}"`,
      );

      for (const index of rename.indexes ?? []) {
        const [present] = await sql<{ exists: boolean }[]>`
          select exists (
            select 1 from pg_indexes
            where schemaname = 'public' and indexname = ${index.from}
          ) as exists
        `;
        if (present.exists) {
          await sql.unsafe(
            `alter index "${index.from}" rename to "${index.to}"`,
          );
        }
      }

      applied += 1;
    }

    console.log(
      applied === 0
        ? "Nothing to rename; the schema is already current."
        : `${applied} rename${applied === 1 ? "" : "s"} applied.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Pre-migration failed. The schema push has NOT been run.");
  console.error(error);
  process.exit(1);
});
