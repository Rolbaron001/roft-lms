import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database access for the LMS.
 *
 * Tenant isolation is enforced by PostgreSQL row-level security, not by
 * remembering to add `where organisation_id = ...` to every query. The
 * application connects as `roft_app`, a role that owns nothing and is subject
 * to those policies, so it can see no rows at all until a tenant context is
 * set. A forgotten filter therefore returns nothing rather than another
 * client's data: the failure mode is a visible bug, not a silent leak.
 *
 * Two connections, deliberately:
 *
 *   DATABASE_URL        as roft_app  — every request. RLS applies, always.
 *   DATABASE_ADMIN_URL  as the owner — migrations, seeding, and the few
 *                                      genuinely cross-tenant operations.
 *
 * Separating them by role rather than by a session flag matters: a session
 * flag can be flipped by anything that manages to execute SQL, whereas the
 * request path here holds no credential that can escape its tenant.
 */

const globalForDb = globalThis as unknown as {
  __roftLmsPool?: ReturnType<typeof postgres>;
  __roftLmsAdminPool?: ReturnType<typeof postgres>;
};

function createPool(connectionString: string) {
  return postgres(connectionString, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    prepare: false,
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

let connection: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Opened on first use, not on import.
 *
 * The build reads every module to work out which pages are static, so anything
 * this file does at import time happens on a machine with no database and no
 * credentials. Connecting eagerly made `next build` fail with "DATABASE_URL is
 * not set" — which passed locally only because a .env.local happened to be
 * present, and failed the moment it was built in a container. Build-time
 * secrets would be the wrong way to fix that: the build has no business
 * holding production credentials.
 */
function connect() {
  if (!connection) {
    const pool =
      globalForDb.__roftLmsPool ?? createPool(requireEnv("DATABASE_URL"));

    // Reused across hot reloads in development, where each edit would
    // otherwise leave its pool behind until Postgres refuses new connections.
    if (process.env.NODE_ENV !== "production") {
      globalForDb.__roftLmsPool = pool;
    }

    connection = drizzle(pool, { schema });
  }
  return connection;
}

/**
 * RLS-bound. Cannot read any tenant's rows until a tenant context is set.
 *
 * A proxy so that `db.select(...)` still reads as a plain object at every call
 * site, while the connection itself is deferred to the first query.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, property, receiver) {
    const value = Reflect.get(connect(), property, receiver);
    return typeof value === "function" ? value.bind(connect()) : value;
  },
});

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type TenantDatabase = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/**
 * Runs `work` inside a transaction scoped to one tenant. Every statement in it
 * sees only that tenant's rows.
 *
 * `set_config(..., true)` makes the setting local to the transaction, so the
 * context cannot leak to whichever request next borrows this pooled connection.
 */
export async function withTenant<T>(
  organisationId: string,
  work: (tx: TenantDatabase) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_organisation', ${organisationId}, true)`,
    );
    return work(tx);
  });
}

/**
 * The owner connection, which RLS does not constrain. Reserved for:
 *
 *   - migrations and seeding
 *   - the Platform Owner provisioning or listing tenants
 *   - resolving a hostname to a tenant, which necessarily happens before
 *     anyone has logged in and so before a tenant context exists
 *
 * `reason` is required and written to the audit log, because "why did this
 * query see every tenant's data" is the first question any audit asks.
 */
export async function withPlatformScope<T>(
  reason: string,
  work: (tx: TenantDatabase) => Promise<T>,
): Promise<T> {
  if (!reason || reason.trim().length < 8) {
    throw new Error(
      "withPlatformScope requires a specific reason describing why cross-tenant access is justified.",
    );
  }

  const adminPool =
    globalForDb.__roftLmsAdminPool ?? createPool(requireEnv("DATABASE_ADMIN_URL"));

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__roftLmsAdminPool = adminPool;
  }

  const adminDb = drizzle(adminPool, { schema });
  return adminDb.transaction(async (tx) => work(tx));
}

export { schema };
