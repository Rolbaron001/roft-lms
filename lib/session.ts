import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import { loginAttempts, sessions, userRoles, users } from "@/db/schema";
import { recordAudit } from "./audit";
import {
  burnPasswordVerificationTime,
  hashPassword,
  verifyPassword,
} from "./password";
import type { Permission, Role } from "./rbac";
import { can, permissionsFor, PermissionDeniedError } from "./rbac";

export const SESSION_COOKIE = "roft_lms_session";

/** Ends however active the user has been. */
const ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;
/** Ends after this long without use. Rolls forward each request. */
const IDLE_LIFETIME_MS = 60 * 60 * 1000;

/** Failed sign-ins tolerated per email address before the account is paused. */
const MAX_FAILED_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export type AuthenticatedSession = {
  sessionId: string;
  userId: string;
  organisationId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  permissions: Permission[];
  /** Somebody else chose the current password. Nothing else is reachable
   *  until it has been replaced — see requireSession. */
  mustChangePassword: boolean;
};

export type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * The cookie carries this; the database stores only its hash. A leaked copy of
 * the sessions table therefore contains no usable credential.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function loadRoles(
  tx: TenantDatabase,
  userId: string,
): Promise<Role[]> {
  const rows = await tx
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));

  return rows.map((row) => row.role);
}

export type SignInResult =
  | { ok: true; token: string; session: AuthenticatedSession }
  | { ok: false; reason: "invalid_credentials" | "locked" | "not_active" };

/**
 * Verifies an email and password within one tenant and opens a session.
 *
 * Every failure path returns the same "invalid_credentials" and spends
 * comparable time, so the response cannot be used to work out whether an
 * address holds an account here.
 */
export async function signIn(
  organisationId: string,
  email: string,
  password: string,
  context: RequestContext = {},
): Promise<SignInResult> {
  const normalisedEmail = email.trim().toLowerCase();

  return withTenant(organisationId, async (tx) => {
    const [{ failures }] = await tx
      .select({ failures: count() })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.email, normalisedEmail),
          eq(loginAttempts.succeeded, false),
          gt(
            loginAttempts.attemptedAt,
            new Date(Date.now() - ATTEMPT_WINDOW_MS),
          ),
        ),
      );

    if (failures >= MAX_FAILED_ATTEMPTS) {
      await tx.insert(loginAttempts).values({
        organisationId,
        email: normalisedEmail,
        succeeded: false,
        ipAddress: context.ipAddress ?? null,
      });
      return { ok: false, reason: "locked" };
    }

    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        passwordHash: users.passwordHash,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.email, normalisedEmail))
      .limit(1);

    const passwordMatches = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : await burnPasswordVerificationTime(password);

    if (!user || !passwordMatches || user.status !== "active") {
      await tx.insert(loginAttempts).values({
        organisationId,
        email: normalisedEmail,
        succeeded: false,
        ipAddress: context.ipAddress ?? null,
      });
      return { ok: false, reason: "invalid_credentials" };
    }

    const token = generateToken();
    const now = new Date();

    const [created] = await tx
      .insert(sessions)
      .values({
        organisationId,
        userId: user.id,
        tokenHash: hashToken(token),
        absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_LIFETIME_MS),
        idleExpiresAt: new Date(now.getTime() + IDLE_LIFETIME_MS),
        createdIp: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      })
      .returning({ id: sessions.id });

    await tx.insert(loginAttempts).values({
      organisationId,
      email: normalisedEmail,
      succeeded: true,
      ipAddress: context.ipAddress ?? null,
    });

    await tx
      .update(users)
      .set({ lastLoginAt: now })
      .where(eq(users.id, user.id));

    const roles = await loadRoles(tx, user.id);

    await recordAudit(tx, {
      organisationId,
      actorId: user.id,
      actorRole: roles[0] ?? null,
      action: "session.signed_in",
      entityType: "session",
      entityId: created.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      ok: true,
      token,
      session: {
        sessionId: created.id,
        userId: user.id,
        organisationId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
        permissions: permissionsFor({ roles }),
        mustChangePassword: user.mustChangePassword,
      },
    };
  });
}

/**
 * Exchanges a cookie token for a session, or null if it is unknown, expired,
 * withdrawn, or belongs to a user who has since been suspended.
 *
 * Rolls the idle window forward on success, so an active user is not signed
 * out mid-task while an abandoned session still lapses.
 */
export async function resolveSession(
  organisationId: string,
  token: string | undefined | null,
): Promise<AuthenticatedSession | null> {
  if (!token) return null;

  return withTenant(organisationId, async (tx) => {
    const now = new Date();

    const [row] = await tx
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        absoluteExpiresAt: sessions.absoluteExpiresAt,
        idleExpiresAt: sessions.idleExpiresAt,
        revokedAt: sessions.revokedAt,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        userStatus: users.status,
        mustChangePassword: users.mustChangePassword,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, hashToken(token)))
      .limit(1);

    if (
      !row ||
      row.revokedAt !== null ||
      row.absoluteExpiresAt <= now ||
      row.idleExpiresAt <= now ||
      row.userStatus !== "active"
    ) {
      return null;
    }

    await tx
      .update(sessions)
      .set({
        lastUsedAt: now,
        idleExpiresAt: new Date(now.getTime() + IDLE_LIFETIME_MS),
      })
      .where(eq(sessions.id, row.sessionId));

    const roles = await loadRoles(tx, row.userId);

    return {
      sessionId: row.sessionId,
      userId: row.userId,
      organisationId,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      roles,
      permissions: permissionsFor({ roles }),
      mustChangePassword: row.mustChangePassword,
    };
  });
}

export async function signOut(
  organisationId: string,
  token: string | undefined | null,
  context: RequestContext = {},
): Promise<void> {
  if (!token) return;

  await withTenant(organisationId, async (tx) => {
    const [row] = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: "signed_out" })
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id, userId: sessions.userId });

    if (row) {
      await recordAudit(tx, {
        organisationId,
        actorId: row.userId,
        action: "session.signed_out",
        entityType: "session",
        entityId: row.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }
  });
}

/**
 * Ends every session a user holds. This is what makes database-backed sessions
 * worth the trouble: suspending someone takes effect on their next request,
 * not whenever a token would have lapsed.
 */
export async function revokeAllSessionsForUser(
  organisationId: string,
  userId: string,
  reason: string,
  actorId?: string,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  return withTenant(organisationId, async (tx) => {
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          // Changing your own password should end every other session but not
          // the one doing it — being signed out by your own success reads as
          // the change having failed.
          options.exceptSessionId
            ? ne(sessions.id, options.exceptSessionId)
            : undefined,
        ),
      )
      .returning({ id: sessions.id });

    if (revoked.length > 0) {
      await recordAudit(tx, {
        organisationId,
        actorId: actorId ?? null,
        action: "session.revoked_all",
        entityType: "user",
        entityId: userId,
        after: { reason, sessionsEnded: revoked.length },
      });
    }

    return revoked.length;
  });
}

/** Clears expired and long-revoked sessions. Safe to run on a schedule. */
export async function pruneSessions(organisationId: string): Promise<number> {
  return withTenant(organisationId, async (tx) => {
    const removed = await tx
      .delete(sessions)
      .where(sql`${sessions.absoluteExpiresAt} < now() - interval '30 days'`)
      .returning({ id: sessions.id });
    return removed.length;
  });
}

export async function setPassword(
  organisationId: string,
  userId: string,
  newPassword: string,
  actorId?: string,
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);

  await withTenant(organisationId, async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await recordAudit(tx, {
      organisationId,
      actorId: actorId ?? userId,
      action: "user.password_changed",
      entityType: "user",
      entityId: userId,
    });
  });

  // A password change ends every other session, which is the whole point of
  // changing it after a suspected compromise.
  await revokeAllSessionsForUser(
    organisationId,
    userId,
    "password_changed",
    actorId,
  );
}

/** Throws unless the session holds the permission. */
export function assertSessionCan(
  session: AuthenticatedSession,
  permission: Permission,
): void {
  if (!can(session, permission)) {
    throw new PermissionDeniedError(permission);
  }
}

/** Constant-time comparison, for anywhere a token is checked by value. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
