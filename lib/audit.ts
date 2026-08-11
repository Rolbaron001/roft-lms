import { auditLog } from "@/db/schema";
import type { TenantDatabase } from "@/db/client";
import type { Role } from "./rbac";

/**
 * Writes to the append-only audit log.
 *
 * Section 10 of the design document requires that every administrative action,
 * every assessment decision and every certificate issued is recorded with who,
 * what and when, and that the record cannot be edited afterwards. The database
 * enforces the second half; this is how the first half gets written.
 *
 * The write joins the caller's transaction on purpose. If the action rolls
 * back, so does its audit entry — a log of things that did not happen is worse
 * than no log.
 */

export type AuditEntry = {
  organisationId: string;
  actorId?: string | null;
  actorRole?: Role | null;
  /** Verb in the past tense, dot-namespaced: "course.published". */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** Field names whose values must never be copied into the log. */
const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "tokenhash",
  "token_hash",
  "token",
  "secret",
  "authsecret",
  "sessiontoken",
]);

/**
 * Strips credentials from a before/after snapshot. Audit records are read by
 * external verifiers, so a password hash landing in one is a disclosure, and
 * the log cannot be edited to take it back out.
 */
export function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      key,
      REDACTED_KEYS.has(key.toLowerCase().replace(/[^a-z_]/g, ""))
        ? "[redacted]"
        : redact(inner),
    ]),
  );
}

export async function recordAudit(
  tx: TenantDatabase,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditLog).values({
    organisationId: entry.organisationId,
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before === undefined ? null : redact(entry.before),
    after: entry.after === undefined ? null : redact(entry.after),
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
  });
}
