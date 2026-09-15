/**
 * Renames and index reshapes that have to happen before the schema is pushed.
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
  {
    table: "ai_user_settings",
    from: "enabled",
    to: "available",
    why: "Enabled used to mean switched on. Switched on is now per sitting and lives on the session; this column is the person's standing permission for themselves, which is a different thing and had to stop sharing a name with it.",
  },
];

/**
 * Index definitions `drizzle-kit push` will not change on its own.
 *
 * Push compares indexes by name. An index that already exists under the right
 * name is left alone even when its definition has changed underneath it, which
 * was proved here rather than assumed: adding `where kind = 'full'` to the
 * curriculum-code index in the schema and running push produced no complaint
 * and no change, and the database kept the unconditional unique index.
 *
 * That particular one is not cosmetic. A part qualification carries its
 * parent's curriculum code - 118710 and 118709 share one - so an unconditional
 * unique index on (organisation, curriculum code) makes it impossible to
 * record the second one. Dropping and recreating by hand is the only way it
 * lands, so it is done here where it runs on every deploy.
 */
type Reshape = {
  name: string;
  table: string;
  /**
   * The columns the index definition mentions.
   *
   * Checked before the index is built, because an index can reference a column
   * the push has not created yet - and on 9 September 2026 one did. The
   * curriculum-code index is partial on `kind`, `kind` was newer than the
   * production database, and this script runs before the push that would have
   * added it. It failed, the `&&` in the deploy stopped the push, so `kind`
   * was never created, so it failed again the next day, and the next. Six days
   * of deploys blocked by an ordering mistake that could only unblock itself.
   *
   * Reshapes now run after the push (see the --phase argument), and this list
   * is the second guard: a reshape whose columns are missing is skipped and
   * said out loud, rather than stopping the deploy.
   */
  columns: string[];
  /** Recognises the definition we want, so a matching index is left alone. */
  wanted: RegExp;
  create: string;
  why: string;
};

const RESHAPES: Reshape[] = [
  {
    name: "qualifications_org_curriculum_code_idx",
    table: "qualifications",
    columns: ["organisation_id", "curriculum_code", "kind"],
    wanted: /where \(kind = 'full'/i,
    create:
      "create unique index qualifications_org_curriculum_code_idx on public.qualifications (organisation_id, curriculum_code) where kind = 'full'",
    why: "A part qualification shares its parent's curriculum code, so only full qualifications can be unique on it.",
  },
];

/**
 * Which half to run.
 *
 * Renames must happen *before* `drizzle-kit push`: left to itself push sees a
 * column vanish and another appear, drops the first and creates the second
 * empty. Reshapes must happen *after* it, because the push is what creates the
 * columns an index may reference. Running both before the push is what blocked
 * every deploy from 9 to 15 September 2026.
 *
 *   --phase renames    before the push
 *   --phase reshapes   after it
 *   (neither)          both, for local use where the schema is already current
 */
const phase = (() => {
  const index = process.argv.indexOf("--phase");
  const value = index === -1 ? "all" : process.argv[index + 1];
  if (value !== "renames" && value !== "reshapes" && value !== "all") {
    console.error(`Unknown phase "${value}". Use renames, reshapes, or omit it.`);
    process.exit(1);
  }
  return value;
})();

async function main() {
  const sql = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  let applied = 0;

  try {
    for (const rename of phase === "reshapes" ? [] : RENAMES) {
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

    if (phase !== "reshapes") {
      console.log(
        applied === 0
          ? "Nothing to rename; the schema is already current."
          : `${applied} rename${applied === 1 ? "" : "s"} applied.`,
      );
    }

    let reshaped = 0;

    for (const reshape of phase === "renames" ? [] : RESHAPES) {
      const [existing] = await sql<{ indexdef: string }[]>`
        select indexdef from pg_indexes
        where schemaname = 'public' and indexname = ${reshape.name}
      `;

      const [table] = await sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = ${reshape.table}
        ) as exists
      `;

      if (!table.exists) {
        // A fresh database. The push creates the table and its indexes.
        continue;
      }

      /**
       * The guard that was missing. An index can name a column the push has
       * not created yet, and building it then fails the whole deploy - which
       * is how six days of deploys were lost.
       */
      const present = await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = ${reshape.table}
      `;
      const have = new Set(present.map((row) => row.column_name));
      const missing = reshape.columns.filter((column) => !have.has(column));

      if (missing.length > 0) {
        console.log(
          `Skipping index ${reshape.name}: ${reshape.table} has no ${missing.join(", ")} yet.
` +
            "  The push creates it; this index is built on the next deploy.",
        );
        continue;
      }

      if (existing && reshape.wanted.test(existing.indexdef)) {
        continue;
      }

      console.log(`Reshaping index ${reshape.name}
  ${reshape.why}`);
      await sql.unsafe(`drop index if exists "${reshape.name}"`);
      await sql.unsafe(reshape.create);
      reshaped += 1;
    }

    if (reshaped > 0) {
      console.log(
        `${reshaped} index${reshaped === 1 ? "" : "es"} reshaped.`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Pre-migration failed. The schema push has NOT been run.");
  console.error(error);
  process.exit(1);
});
