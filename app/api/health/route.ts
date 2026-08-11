import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Liveness and readiness for the reverse proxy and the uptime monitor.
 *
 * It queries the database rather than just returning 200, because an app that
 * answers cheerfully while its database is unreachable is worse than one that
 * is plainly down: nothing alerts, and the first person to notice is a learner
 * mid-assessment.
 *
 * Deliberately returns nothing identifying. It is reachable without signing
 * in, so it must not become a way to learn what is running here.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await db.execute(sql`select 1`);

    return Response.json(
      { status: "ok", databaseMs: Date.now() - startedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
