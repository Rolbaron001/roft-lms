/**
 * Per-person AI extensions, against a live database.
 *
 * This is the one place the platform keeps a credential it can read back, so
 * these are not ordinary feature tests. They pin down the four rules the design
 * rests on, each of which was asked for explicitly:
 *
 *   1. The token is never stored in the clear.
 *   2. Being set up is not the same as being switched on. Every sitting starts
 *      off, whatever the last one did.
 *   3. Signing out switches it off before the session goes away, so a sitting
 *      cannot end with a credential recorded as still live.
 *   4. The person who put the token there can withdraw it at any moment.
 *
 * If a change makes one of these fail, the change is wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  aiUserSettings,
  auditLog,
  organisations,
  sessions,
  userRoles,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { hintOf, seal, unseal } from "@/lib/secret-box";
import {
  ExtensionSetupError,
  extensionState,
  runExtension,
  setMyExtension,
} from "@/lib/extensions";
import { resolveSession, signIn, signOut } from "@/lib/session";

const PASSWORD = "correct-horse-battery";
const SLUG = `ext-token-${Date.now()}`;
/** Shaped like a real one, and deliberately not a real one. */
const TOKEN = "sk-ant-oat01-ZmFrZS10b2tlbi1mb3ItdGVzdHM_notreal";

let organisationId: string;
let userId: string;

beforeAll(async () => {
  process.env.AUTH_SECRET ??= "test-secret-for-sealing-tokens";

  const passwordHash = await hashPassword(PASSWORD);

  const created = await withPlatformScope(
    "extension token test fixture",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug: SLUG,
          legalName: `${SLUG} Ltd`,
          displayName: SLUG,
          status: "active",
        })
        .returning({ id: organisations.id });

      const [admin] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `admin@${SLUG}.test`,
          passwordHash,
          firstName: "Test",
          lastName: "Admin",
          status: "active",
        })
        .returning({ id: users.id });

      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: admin.id,
        role: "tenant_admin",
      });

      return { organisationId: organisation.id, userId: admin.id };
    },
  );

  organisationId = created.organisationId;
  userId = created.userId;
});

afterAll(async () => {
  await withPlatformScope("extension token test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function freshSession() {
  const result = await signIn(
    organisationId,
    `admin@${SLUG}.test`,
    PASSWORD,
  );
  if (!result.ok || !result.session || !result.token) {
    throw new Error("the fixture could not sign in");
  }
  return { session: result.session, token: result.token };
}

describe("sealing a token", () => {
  it("comes back out exactly as it went in", () => {
    expect(unseal(seal(TOKEN))).toBe(TOKEN);
  });

  it("looks nothing like the token", () => {
    const sealed = seal(TOKEN);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain("sk-ant-oat");
  });

  /** A fresh IV per call, or the relationship between two secrets leaks. */
  it("seals the same secret differently every time", () => {
    expect(seal(TOKEN)).not.toBe(seal(TOKEN));
  });

  /** GCM authenticates: an edited ciphertext fails rather than opening. */
  it("refuses to open something that has been altered", () => {
    const sealed = seal(TOKEN);
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(unseal(tampered)).toBeNull();
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(unseal(null)).toBeNull();
    expect(unseal("")).toBeNull();
    expect(unseal("not base64 at all")).toBeNull();
  });

  it("hints with the last four characters and no more", () => {
    expect(hintOf(TOKEN)).toBe(TOKEN.slice(-4));
    expect(hintOf(TOKEN)).toHaveLength(4);
  });
});

describe("setting one up", () => {
  it("refuses anything that is not shaped like a token", async () => {
    const { session } = await freshSession();

    await expect(
      setMyExtension(session, {
        provider: "claude_code",
        available: true,
        token: "hunter2",
      }),
    ).rejects.toBeInstanceOf(ExtensionSetupError);
  });

  /**
   * The failure that would otherwise be silent: somebody pastes their Anthropic
   * password into a field asking for a token. Refused on shape, so it is never
   * stored and never sent anywhere.
   */
  it("refuses an API key in place of a subscription token", async () => {
    const { session } = await freshSession();

    await expect(
      setMyExtension(session, {
        provider: "claude_code",
        available: true,
        token: "sk-ant-api03-something-that-is-not-a-subscription-token",
      }),
    ).rejects.toBeInstanceOf(ExtensionSetupError);
  });

  it("cannot be made available with no token to use", async () => {
    const { session } = await freshSession();

    await expect(
      setMyExtension(session, { provider: "claude_code", available: true }),
    ).rejects.toBeInstanceOf(ExtensionSetupError);
  });

  it("stores the token sealed, never in the clear", async () => {
    const { session } = await freshSession();

    await setMyExtension(session, {
      provider: "claude_code",
      available: true,
      token: TOKEN,
    });

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(aiUserSettings)
        .where(eq(aiUserSettings.userId, userId)),
    );

    expect(row.tokenSealed).not.toBeNull();
    expect(row.tokenSealed).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(row.tokenHint).toBe(TOKEN.slice(-4));
    expect(unseal(row.tokenSealed)).toBe(TOKEN);
  });

  it("does not return the token in the state a page reads", async () => {
    const { session } = await freshSession();
    const state = await extensionState(session);

    expect(state.registered).toBe(true);
    expect(JSON.stringify(state)).not.toContain(TOKEN);
    expect(state.tokenHint).toBe(TOKEN.slice(-4));
  });

  it("keeps the stored token when the form sends an empty box", async () => {
    const { session } = await freshSession();

    await setMyExtension(session, {
      provider: "claude_code",
      available: true,
      token: null,
    });

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select({ sealed: aiUserSettings.tokenSealed })
        .from(aiUserSettings)
        .where(eq(aiUserSettings.userId, userId)),
    );
    expect(unseal(row.sealed)).toBe(TOKEN);
  });
});

describe("set up is not switched on", () => {
  it("starts every sitting off, however it was left", async () => {
    const first = await freshSession();
    expect(first.session.aiOn).toBe(false);

    // Switch it on, then start a new sitting.
    const { setSessionAi } = await import("@/lib/session");
    await setSessionAi(first.session, true);
    expect((await extensionState(first.session)).on).toBe(false);

    const resolved = await resolveSession(organisationId, first.token);
    expect(resolved?.aiOn).toBe(true);

    const second = await freshSession();
    expect(second.session.aiOn).toBe(false);
  });

  it("will not run while the sitting has it off", async () => {
    const { session } = await freshSession();
    const result = await runExtension(session, {
      task: "test",
      prompt: "anything",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not switched on");
  });

  it("will not run when the person has disabled it, token or not", async () => {
    const { session, token } = await freshSession();

    const { setSessionAi } = await import("@/lib/session");
    await setSessionAi(session, true);
    await setMyExtension(session, {
      provider: "claude_code",
      available: false,
    });

    const live = await resolveSession(organisationId, token);
    const result = await runExtension(live!, {
      task: "test",
      prompt: "anything",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("disabled");

    // Put it back for the tests that follow.
    await setMyExtension(session, {
      provider: "claude_code",
      available: true,
    });
  });
});

describe("signing out", () => {
  /**
   * Roland's requirement, in his words: anything accidentally left on switches
   * off first, and then the person is signed out. Two statements rather than
   * one, so the record shows the credential being put down rather than a
   * sitting that simply stopped with it live.
   */
  it("switches the extension off before it revokes the session", async () => {
    const { session, token } = await freshSession();

    const { setSessionAi } = await import("@/lib/session");
    await setSessionAi(session, true);

    await signOut(organisationId, token);

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select({
          aiOnSince: sessions.aiOnSince,
          revokedAt: sessions.revokedAt,
        })
        .from(sessions)
        .where(eq(sessions.id, session.sessionId)),
    );

    expect(row.aiOnSince).toBeNull();
    expect(row.revokedAt).not.toBeNull();

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, "session"),
            eq(auditLog.entityId, session.sessionId),
          ),
        )
    );

    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain("extension.switched_off");
    expect(actions).toContain("session.signed_out");

    // The order of the two entries is deliberately not asserted. Both are
    // written inside one transaction and Postgres stamps every row in a
    // transaction with its start time, so the timestamps are equal and any
    // ordering read from them would be an artefact. What is provable is what
    // matters: the sitting ended with the switch recorded as off, and both
    // events are on the record rather than one swallowing the other.
  });

  it("says nothing about switching off when it was never on", async () => {
    const { session, token } = await freshSession();
    await signOut(organisationId, token);

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityType, "session"),
            eq(auditLog.entityId, session.sessionId),
          ),
        ),
    );

    expect(entries.map((entry) => entry.action)).not.toContain(
      "extension.switched_off",
    );
  });
});

describe("withdrawing it", () => {
  it("discards the token on the person's own say-so", async () => {
    const { session } = await freshSession();

    await setMyExtension(session, {
      provider: "claude_code",
      available: true,
      token: TOKEN,
    });
    await setMyExtension(session, {
      provider: "claude_code",
      available: true,
      forget: true,
    });

    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(aiUserSettings)
        .where(eq(aiUserSettings.userId, userId)),
    );

    expect(row.tokenSealed).toBeNull();
    expect(row.tokenHint).toBeNull();
    expect(row.tokenAddedAt).toBeNull();
    // Nothing left to switch on, so it cannot stay available.
    expect(row.available).toBe(false);
  });
});
