import { createHash } from "node:crypto";
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
/**
 * Whether this request is an administrator viewing the platform as somebody
 * else (lib/view-as.ts). Read from the request's cookie; outside a request
 * (scripts, the scheduled jobs, tests) there is none.
 */
async function requestCookies(): Promise<{ viewAs: boolean; sessionToken: string | null }> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return {
      viewAs: Boolean(store.get("roft_view_as")?.value),
      sessionToken: store.get("roft_lms_session")?.value ?? null,
    };
  } catch {
    return { viewAs: false, sessionToken: null };
  }
}

/**
 * Whether the session behind this cookie belongs to somebody holding
 * "Administrator View" (lib/rbac.ts, `tenant_viewer`). Asked inside the
 * transaction, after the tenant is set, so the row-level policies apply to
 * the question as to everything else. Remembered for half a minute per
 * session, since a page opens several transactions.
 */
const viewOnlyRemembered = new Map<string, { viewOnly: boolean; until: number }>();

async function sessionIsViewOnly(tx: TenantDatabase, token: string): Promise<boolean> {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const known = viewOnlyRemembered.get(tokenHash);
  if (known && known.until > Date.now()) return known.viewOnly;
  const rows = await tx.execute(sql`
    select 1 from sessions s
    join user_roles r on r.user_id = s.user_id and r.revoked_at is null
    where s.token_hash = ${tokenHash} and r.role = 'tenant_viewer'
    limit 1`);
  const viewOnly = rows.length > 0;
  if (viewOnlyRemembered.size > 5000) viewOnlyRemembered.clear();
  viewOnlyRemembered.set(tokenHash, { viewOnly, until: Date.now() + 30_000 });
  return viewOnly;
}

/**
 * Whether this transaction may not write: "View as" or "Administrator View".
 * For housekeeping a page does as it renders, which waits for a reader who
 * may write rather than refusing the page.
 */
export async function transactionIsReadOnly(tx: TenantDatabase): Promise<boolean> {
  const [row] = await tx.execute(sql`select current_setting('transaction_read_only') as read_only`);
  return (row as { read_only?: string } | undefined)?.read_only === "on";
}

/** Forgets what was remembered above, for a test that changes somebody's roles. */
export function forgetViewOnly(): void {
  viewOnlyRemembered.clear();
}

export async function withTenant<T>(
  organisationId: string,
  work: (tx: TenantDatabase) => Promise<T>,
  options: {
    /**
     * Writes that belong to the person's own sitting rather than to the
     * provider's records: signing in and out, their own password, their
     * language, switching the extension, marking a notification read. These
     * stay possible under "Administrator View", which would otherwise lock
     * somebody out of signing out. Never while viewing as somebody else.
     */
    ownSitting?: boolean;
  } = {},
): Promise<T> {
  const request = await requestCookies();
  let viewOnly = false;
  try {
    return await db.transaction(async (tx) => {
      // While viewing as somebody else nothing may be written, by any page or
      // action, however it was written: PostgreSQL refuses it for us.
      if (request.viewAs) await tx.execute(sql`set transaction read only`);
      await tx.execute(
        sql`select set_config('app.current_organisation', ${organisationId}, true)`,
      );
      // The same lock for "Administrator View", decided by the database's own
      // record of who holds the role, never by anything the browser sends.
      if (!request.viewAs && !options.ownSitting && request.sessionToken && (await sessionIsViewOnly(tx, request.sessionToken))) {
        viewOnly = true;
        await tx.execute(sql`set transaction read only`);
      }
      return work(tx);
    });
  } catch (error) {
    // PostgreSQL's read_only_sql_transaction, said as the refusal it is.
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (viewOnly && code === "25006") {
      const { ViewOnlyError } = await import("@/lib/rbac");
      throw new ViewOnlyError();
    }
    throw error;
  }
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
