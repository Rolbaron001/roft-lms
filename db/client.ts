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

const pool = globalForDb.__roftLmsPool ?? createPool(requireEnv("DATABASE_URL"));

if (process.env.NODE_ENV !== "production") {
  globalForDb.__roftLmsPool = pool;
}

/** RLS-bound. Cannot read any tenant's rows until a tenant context is set. */
export const db = drizzle(pool, { schema });

export type Database = typeof db;
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
