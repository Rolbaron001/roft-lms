/**
 * Makes sure the database exists and is reachable before anything else runs.
 *
 * Called by start-lms.bat. Everything it reports is written for someone who
 * wants to know what to do next, not a stack trace.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const adminUrl = process.env.DATABASE_ADMIN_URL;

if (!adminUrl) {
  console.error(
    [
      "",
      "  No database settings found.",
      "",
      "  Copy .env.example to .env.local and fill in the two connection",
      "  strings. The README explains each one.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const url = new URL(adminUrl);
const targetDatabase = decodeURIComponent(url.pathname.replace(/^\//, ""));

/** Same server, but the always-present maintenance database. */
function maintenanceUrl(): string {
  const copy = new URL(adminUrl!);
  copy.pathname = "/postgres";
  return copy.toString();
}

function explainConnectionFailure(error: unknown): never {
  const code = (error as { code?: string })?.code;
  const message = (error as Error)?.message ?? String(error);

  if (code === "ECONNREFUSED") {
    console.error(
      [
        "",
        "  PostgreSQL is not answering on " + url.host + ".",
        "",
        "  It is usually a service that starts with Windows. To start it now,",
        "  open PowerShell as administrator and run:",
        "",
        "      Start-Service postgresql-x64-18",
        "",
        "  If PostgreSQL is not installed yet:",
        "",
        "      winget install -e --id PostgreSQL.PostgreSQL.18",
        "",
      ].join("\n"),
    );
  } else if (code === "28P01" || /password authentication failed/i.test(message)) {
    console.error(
      [
        "",
        "  PostgreSQL refused the password in .env.local.",
        "",
        "  Check DATABASE_ADMIN_URL. If the password contains # or @ or /,",
        "  those characters have to be percent-encoded: # becomes %23,",
        "  @ becomes %40, / becomes %2F.",
        "",
      ].join("\n"),
    );
  } else {
    console.error("\n  Could not reach the database: " + message + "\n");
  }

  process.exit(1);
}

async function main() {
  const maintenance = postgres(maintenanceUrl(), {
    max: 1,
    onnotice: () => {},
    connect_timeout: 10,
  });

  try {
    const existing = await maintenance<{ datname: string }[]>`
      select datname from pg_database where datname = ${targetDatabase}
    `;

    if (existing.length === 0) {
      // A database name cannot be a bound parameter, so it is quoted as an
      // identifier instead. postgres.js escapes it properly.
      await maintenance`create database ${maintenance(targetDatabase)}`;
      console.log(`  Created the database "${targetDatabase}".`);
    } else {
      console.log(`  Database "${targetDatabase}" is ready.`);
    }
  } catch (error) {
    explainConnectionFailure(error);
  } finally {
    await maintenance.end();
  }
}

await main();
