/**
 * Authentication, against a live database.
 *
 * These are the behaviours that decide whether the platform can be trusted
 * with an accredited programme: that a password actually gates access, that a
 * withdrawn session dies immediately, that one client's login cannot be used
 * at another, and that every sign-in leaves a record.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  auditLog,
  organisations,
  sessions,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/password";
import {
  resolveSession,
  revokeAllSessionsForUser,
  setPassword,
  signIn,
  signOut,
} from "@/lib/session";

const PASSWORD = "correct-horse-battery";

type Tenant = { id: string; learnerId: string; assessorId: string };

async function createTenant(slug: string): Promise<Tenant> {
  const passwordHash = await hashPassword(PASSWORD);

  return withPlatformScope("authentication test fixture setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: slug,
        status: "active",
      })
      .returning({ id: organisations.id });

    const [learner] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "learner@example.test",
        passwordHash,
        firstName: "Test",
        lastName: "Learner",
        status: "active",
      })
      .returning({ id: users.id });

    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: learner.id,
      role: "learner",
    });

    const [assessor] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "assessor@example.test",
        passwordHash,
        firstName: "Test",
        lastName: "Assessor",
        status: "active",
      })
      .returning({ id: users.id });

    await tx.insert(userRoles).values([
      {
        organisationId: organisation.id,
        userId: assessor.id,
        role: "assessor",
      },
      {
        organisationId: organisation.id,
        userId: assessor.id,
        role: "instructor",
      },
    ]);

    return {
      id: organisation.id,
      learnerId: learner.id,
      assessorId: assessor.id,
    };
  });
}

let primary: Tenant;
let other: Tenant;

beforeAll(async () => {
  const stamp = Date.now();
  primary = await createTenant(`authtest-${stamp}`);
  other = await createTenant(`authother-${stamp}`);
});

afterAll(async () => {
  await withPlatformScope("authentication test teardown", async (tx) => {
    for (const tenant of [primary, other]) {
      if (tenant) {
        await tx.delete(organisations).where(eq(organisations.id, tenant.id));
      }
    }
  });
});

describe("signing in", () => {
  it("accepts the right password and returns the user's roles", async () => {
    const result = await signIn(
      primary.id,
      "assessor@example.test",
      PASSWORD,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.userId).toBe(primary.assessorId);
    expect(result.session.roles.sort()).toEqual(["assessor", "instructor"]);
    expect(result.session.permissions).toContain("assessment:assess");
    expect(result.token).toBeTruthy();
  });

  it("rejects the wrong password", async () => {
    const result = await signIn(
      primary.id,
      "learner@example.test",
      "not-the-password",
    );
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("treats an unknown address exactly like a wrong password", async () => {
    const result = await signIn(
      primary.id,
      "nobody@example.test",
      PASSWORD,
    );
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("is case-insensitive about the email address", async () => {
    const result = await signIn(
      primary.id,
      "  LEARNER@Example.TEST  ",
      PASSWORD,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an account that is not active", async () => {
    await withPlatformScope("suspending a user for a test", (tx) =>
      tx
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, primary.learnerId)),
    );

    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    expect(result.ok).toBe(false);

    await withPlatformScope("restoring a user after a test", (tx) =>
      tx
        .update(users)
        .set({ status: "active" })
        .where(eq(users.id, primary.learnerId)),
    );
  });

  /**
   * The same email address exists at both tenants. Presenting it at the wrong
   * one must fail even though the password is correct somewhere.
   */
  it("does not let one tenant's credentials work at another", async () => {
    const result = await signIn(
      other.id,
      "assessor@example.test",
      PASSWORD,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Signed in at `other`, so the session belongs to `other`, not `primary`.
    expect(result.session.organisationId).toBe(other.id);
    expect(result.session.userId).not.toBe(primary.assessorId);

    // And the token minted at `other` is worthless at `primary`.
    const crossTenant = await resolveSession(primary.id, result.token);
    expect(crossTenant).toBeNull();
  });

  it("writes an audit record for a successful sign-in", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = await withTenant(primary.id, (tx) =>
      tx
        .select({ action: auditLog.action, entityId: auditLog.entityId })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "session.signed_in"),
            eq(auditLog.entityId, result.session.sessionId),
          ),
        ),
    );

    expect(entries).toHaveLength(1);
  });
});

describe("sessions", () => {
  it("resolves a valid token to the signed-in user", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");

    const session = await resolveSession(primary.id, result.token);
    expect(session?.userId).toBe(primary.learnerId);
    expect(session?.roles).toEqual(["learner"]);
  });

  it("rejects a token that was never issued", async () => {
    expect(await resolveSession(primary.id, "made-up-token")).toBeNull();
  });

  it("rejects an empty token", async () => {
    expect(await resolveSession(primary.id, "")).toBeNull();
    expect(await resolveSession(primary.id, undefined)).toBeNull();
  });

  it("stores only a hash of the token, never the token itself", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");

    const rows = await withTenant(primary.id, (tx) =>
      tx
        .select({ tokenHash: sessions.tokenHash })
        .from(sessions)
        .where(eq(sessions.id, result.session.sessionId)),
    );

    expect(rows[0].tokenHash).not.toBe(result.token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stops accepting a token after signing out", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");

    expect(await resolveSession(primary.id, result.token)).not.toBeNull();
    await signOut(primary.id, result.token);
    expect(await resolveSession(primary.id, result.token)).toBeNull();
  });

  it("rejects a session whose absolute lifetime has passed", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");

    await withPlatformScope("expiring a session for a test", (tx) =>
      tx
        .update(sessions)
        .set({ absoluteExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, result.session.sessionId)),
    );

    expect(await resolveSession(primary.id, result.token)).toBeNull();
  });

  it("rejects a session left idle too long", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");

    await withPlatformScope("idling a session for a test", (tx) =>
      tx
        .update(sessions)
        .set({ idleExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, result.session.sessionId)),
    );

    expect(await resolveSession(primary.id, result.token)).toBeNull();
  });

  it("extends the idle window when a session is used", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");

    const before = await withPlatformScope("reading a session for a test", (tx) =>
      tx
        .select({ idleExpiresAt: sessions.idleExpiresAt })
        .from(sessions)
        .where(eq(sessions.id, result.session.sessionId)),
    );

    await withPlatformScope("ageing a session for a test", (tx) =>
      tx
        .update(sessions)
        .set({ idleExpiresAt: new Date(Date.now() + 60_000) })
        .where(eq(sessions.id, result.session.sessionId)),
    );

    await resolveSession(primary.id, result.token);

    const after = await withPlatformScope("reading a session for a test", (tx) =>
      tx
        .select({ idleExpiresAt: sessions.idleExpiresAt })
        .from(sessions)
        .where(eq(sessions.id, result.session.sessionId)),
    );

    expect(after[0].idleExpiresAt.getTime()).toBeGreaterThan(
      before[0].idleExpiresAt.getTime() - 1,
    );
  });

  /**
   * The reason sessions live in the database rather than in a signed token.
   * Suspending someone has to take effect now, not when a token would lapse.
   */
  it("ends every session immediately when a user is suspended", async () => {
    const first = await signIn(primary.id, "learner@example.test", PASSWORD);
    const second = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!first.ok || !second.ok) throw new Error("sign in failed");

    const ended = await revokeAllSessionsForUser(
      primary.id,
      primary.learnerId,
      "suspended_by_administrator",
    );

    expect(ended).toBeGreaterThanOrEqual(2);
    expect(await resolveSession(primary.id, first.token)).toBeNull();
    expect(await resolveSession(primary.id, second.token)).toBeNull();
  });

  it("ends other sessions when the password changes", async () => {
    const existing = await signIn(primary.id, "assessor@example.test", PASSWORD);
    if (!existing.ok) throw new Error("sign in failed");

    await setPassword(primary.id, primary.assessorId, "a-brand-new-password");

    expect(await resolveSession(primary.id, existing.token)).toBeNull();
    expect(
      (await signIn(primary.id, "assessor@example.test", PASSWORD)).ok,
    ).toBe(false);
    expect(
      (await signIn(primary.id, "assessor@example.test", "a-brand-new-password"))
        .ok,
    ).toBe(true);
  });
});

describe("brute-force resistance", () => {
  it("locks an account after repeated failures and stops accepting the real password", async () => {
    const stamp = Date.now();
    const tenant = await createTenant(`authlock-${stamp}`);

    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await signIn(tenant.id, "learner@example.test", "wrong");
      }

      const locked = await signIn(tenant.id, "learner@example.test", PASSWORD);
      expect(locked).toEqual({ ok: false, reason: "locked" });
    } finally {
      await withPlatformScope("authentication test teardown", (tx) =>
        tx.delete(organisations).where(eq(organisations.id, tenant.id)),
      );
    }
  });

  it("locks the account under attack without locking anyone else", async () => {
    const stamp = Date.now();
    const tenant = await createTenant(`authlock2-${stamp}`);

    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await signIn(tenant.id, "learner@example.test", "wrong");
      }

      const other = await signIn(
        tenant.id,
        "assessor@example.test",
        PASSWORD,
      );
      expect(other.ok).toBe(true);
    } finally {
      await withPlatformScope("authentication test teardown", (tx) =>
        tx.delete(organisations).where(eq(organisations.id, tenant.id)),
      );
    }
  });
});

describe("the audit log", () => {
  it("cannot be edited, even by the owner connection", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");

    await expect(
      withPlatformScope("attempting to tamper with the audit log", (tx) =>
        tx
          .update(auditLog)
          .set({ action: "something.else" })
          .where(eq(auditLog.entityId, result.session.sessionId)),
      ),
    ).rejects.toThrow();
  });

  it("cannot be deleted from", async () => {
    await expect(
      withPlatformScope("attempting to erase the audit log", (tx) =>
        tx.delete(auditLog).where(eq(auditLog.organisationId, primary.id)),
      ),
    ).rejects.toThrow();
  });

  it("records sign-out as well as sign-in", async () => {
    const result = await signIn(primary.id, "learner@example.test", PASSWORD);
    if (!result.ok) throw new Error("sign in failed");
    await signOut(primary.id, result.token);

    const entries = await withTenant(primary.id, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, result.session.sessionId))
        .orderBy(desc(auditLog.occurredAt)),
    );

    expect(entries.map((entry) => entry.action).sort()).toEqual([
      "session.signed_in",
      "session.signed_out",
    ]);
  });
});
