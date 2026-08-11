/**
 * Applies db/policies.sql: the row-level security policies, the segregation of
 * duties trigger, the append-only audit log and the data-shape constraints.
 *
 * Run after every migration — `npm run db:push` does both.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appPassword = process.env.ROFT_APP_DB_PASSWORD;

if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL is not set. See .env.example.");
  process.exit(1);
}

if (!appPassword) {
  console.error("ROFT_APP_DB_PASSWORD is not set. See .env.example.");
  process.exit(1);
}

const sqlPath = join(process.cwd(), "db", "policies.sql");

async function main() {
  const statements = await readFile(sqlPath, "utf8");
  const sql = postgres(adminUrl!, { max: 1, onnotice: () => {} });

  try {
    // The policies file reads the application role's password from a session
    // setting rather than having it written into version-controlled SQL.
    await sql.unsafe(
      `set roft.app_password = ${sql.unsafe(`'${appPassword!.replace(/'/g, "''")}'`)}`,
    );
    await sql.unsafe(statements);

    // Creating the role and setting its password are separate concerns: the
    // role may already exist from an earlier run with a different password.
    await sql.unsafe(
      `alter role roft_app with password ${sql.unsafe(`'${appPassword!.replace(/'/g, "''")}'`)}`,
    );

    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count
      from pg_policies
      where schemaname = 'public' and policyname = 'tenant_isolation'
    `;
    console.log(`Policies applied. ${count} tables are tenant-isolated.`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
