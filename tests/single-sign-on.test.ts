/**
 * Signing in with an organisation's Google or Microsoft account. Job sheet D7,
 * 27 September 2026.
 *
 * Against a stand-in token endpoint: each case hands back the ID token Google
 * or Microsoft would, and checks who gets in and who does not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { externalIdentities, organisations, signInProviders, userRoles, users } from "@/db/schema";
import {
  beginSignIn,
  finishSignIn,
  packPending,
  saveSsoProvider,
  signInOptions,
  ssoSettingsFor,
  unpackPending,
  type Pending,
} from "@/lib/single-sign-on";
import { permissionsFor } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
const ids: Record<string, string> = {};
const REDIRECT = "https://keeper.example.test/api/sign-in/google/callback";
const DIRECTORY = "72f988bf-86f1-41af-91ab-2d7cd011db47";

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

/** A token endpoint that answers with this ID token, and remembers what it was sent. */
function endpointAnswering(claims: Record<string, unknown>) {
  const seen: { url: string; body: URLSearchParams }[] = [];
  const send = (async (url: string, init?: RequestInit) => {
    seen.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
    return new Response(JSON.stringify({ id_token: idToken(claims), access_token: "x" }), { status: 200 });
  }) as typeof fetch;
  return { send, seen };
}

async function begin(kind: "google" | "microsoft"): Promise<Pending> {
  return (await beginSignIn(organisationId, kind, REDIRECT)).pending;
}

function googleClaims(pending: Pending, overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: "google-client.apps.googleusercontent.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: pending.nonce,
    sub: "google-sub-1",
    email: "thandi@keeper.example.test",
    email_verified: true,
    ...overrides,
  };
}

beforeAll(async () => {
  const slug = `sso-${Date.now()}`;
  await withPlatformScope("sso fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Keeper", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;
    for (const [name, email, status] of [
      ["admin", `admin-${slug}@example.test`, "active"],
      ["thandi", "thandi@keeper.example.test", "active"],
      ["gone", "gone@keeper.example.test", "suspended"],
    ] as const) {
      const [person] = await tx
        .insert(users)
        .values({ organisationId, email, firstName: name, lastName: "Tester", status })
        .returning({ id: users.id });
      ids[name] = person.id;
    }
    await tx.insert(userRoles).values({ organisationId, userId: ids.admin, role: "tenant_admin" });
  });
  admin = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: ids.admin,
    organisationId,
    email: "a@example.test",
    firstName: "A",
    lastName: "Admin",
    roles: ["tenant_admin"],
    permissions: permissionsFor({ roles: ["tenant_admin"] }),
    mustChangePassword: false,
    aiOn: false,
  };
  await saveSsoProvider(admin, {
    kind: "google",
    clientId: "google-client.apps.googleusercontent.com",
    clientSecret: "google-secret-value",
    allowedDomains: "keeper.example.test",
  });
  await saveSsoProvider(admin, {
    kind: "microsoft",
    clientId: "ms-client",
    clientSecret: "ms-secret-value",
    directoryId: DIRECTORY,
  });
});

afterAll(async () => {
  await withPlatformScope("sso teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("setting it up", () => {
  it("keeps the secret sealed and offers both on the sign-in page", async () => {
    const view = await ssoSettingsFor(admin);
    expect(JSON.stringify(view)).not.toContain("google-secret-value");
    expect(view.find((v) => v.kind === "google")?.secretHint).toBe("alue");
    const [row] = await withPlatformScope("test reads the sealed client secret", (tx) =>
      tx.select().from(signInProviders).where(eq(signInProviders.organisationId, organisationId)),
    );
    expect(row.clientSecretSealed).not.toContain("secret-value");
    expect(await signInOptions(organisationId)).toEqual(["google", "microsoft"]);
  });

  it("will not set up Microsoft without the organisation's directory", async () => {
    await expect(
      saveSsoProvider(admin, { kind: "microsoft", clientId: "ms-client", clientSecret: "x-secret" }),
    ).rejects.toThrow(/directory \(tenant\) ID/);
  });

  it("sends Google the client, a PKCE challenge, a state and a nonce", async () => {
    const { url, pending } = await beginSignIn(organisationId, "google", REDIRECT);
    const query = new URL(url).searchParams;
    expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(query.get("client_id")).toBe("google-client.apps.googleusercontent.com");
    expect(query.get("scope")).toBe("openid email profile");
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("state")).toBe(pending.state);
    expect(query.get("nonce")).toBe(pending.nonce);
    // The cookie cannot be forged.
    expect(unpackPending(packPending(pending))).toEqual(pending);
    expect(unpackPending(`${packPending(pending)}x`)).toBeNull();
  });
});

describe("signing in with Google", () => {
  it("signs in the person with that verified address, and pins the account to them", async () => {
    const pending = await begin("google");
    const { send, seen } = endpointAnswering(googleClaims(pending));
    const result = await finishSignIn(organisationId, pending, { code: "c", state: pending.state, redirectUri: REDIRECT }, {}, send);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.userId).toBe(ids.thandi);
    expect(seen[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(seen[0].body.get("code_verifier")).toBe(pending.verifier);

    const links = await withPlatformScope("test reads the linked external identities", (tx) =>
      tx.select().from(externalIdentities).where(eq(externalIdentities.userId, ids.thandi)),
    );
    expect(links.map((l) => l.subject)).toEqual(["google-sub-1"]);
  });

  it("still knows them after their Google address changes", async () => {
    const pending = await begin("google");
    const { send } = endpointAnswering(googleClaims(pending, { email: "t.new@keeper.example.test" }));
    const result = await finishSignIn(organisationId, pending, { code: "c", state: pending.state, redirectUri: REDIRECT }, {}, send);
    expect(result.ok && result.session.userId).toBe(ids.thandi);
  });

  it("refuses a second Google account with the same person's address", async () => {
    const pending = await begin("google");
    const { send } = endpointAnswering(googleClaims(pending, { sub: "google-sub-2" }));
    const result = await finishSignIn(organisationId, pending, { code: "c", state: pending.state, redirectUri: REDIRECT }, {}, send);
    expect(result.ok).toBe(false);
  });

  const refusals: [string, Record<string, unknown>][] = [
    ["an address Google has not verified", { sub: "s3", email_verified: false }],
    ["somebody with no account here", { sub: "s4", email: "stranger@keeper.example.test" }],
    ["a suspended account", { sub: "s5", email: "gone@keeper.example.test" }],
    ["a domain not allowed", { sub: "s6", email: "thandi@elsewhere.example.test" }],
    ["a token for another client", { sub: "s7", aud: "someone-else" }],
    ["a token from another issuer", { sub: "s8", iss: "https://evil.example.test" }],
    ["an expired token", { sub: "s9", exp: 1000 }],
    ["a different nonce", { sub: "s10", nonce: "replayed" }],
  ];
  for (const [what, claims] of refusals) {
    it(`refuses ${what}`, async () => {
      const pending = await begin("google");
      const { send } = endpointAnswering(googleClaims(pending, claims));
      const result = await finishSignIn(organisationId, pending, { code: "c", state: pending.state, redirectUri: REDIRECT }, {}, send);
      expect(result).toEqual({ ok: false, reason: "sso", message: "That account cannot sign in here." });
    });
  }

  it("refuses a sign-in that came back with somebody else's state", async () => {
    const pending = await begin("google");
    const { send, seen } = endpointAnswering(googleClaims(pending));
    const result = await finishSignIn(organisationId, pending, { code: "c", state: "not-ours", redirectUri: REDIRECT }, {}, send);
    expect(result.ok).toBe(false);
    // Refused before the code was even exchanged.
    expect(seen).toHaveLength(0);
  });
});

describe("signing in with Microsoft", () => {
  const claims = (pending: Pending, overrides: Record<string, unknown> = {}) => ({
    iss: `https://login.microsoftonline.com/${DIRECTORY}/v2.0`,
    aud: "ms-client",
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: pending.nonce,
    sub: "ms-sub-1",
    tid: DIRECTORY,
    preferred_username: "thandi@keeper.example.test",
    ...overrides,
  });

  it("signs in a person from the provider's own directory", async () => {
    const pending = await begin("microsoft");
    const { send, seen } = endpointAnswering(claims(pending));
    const result = await finishSignIn(organisationId, pending, { code: "c", state: pending.state, redirectUri: REDIRECT }, {}, send);
    expect(result.ok && result.session.userId).toBe(ids.thandi);
    expect(seen[0].url).toBe(`https://login.microsoftonline.com/${DIRECTORY}/oauth2/v2.0/token`);
  });

  it("refuses the same address from any other directory", async () => {
    const pending = await begin("microsoft");
    const other = "11111111-2222-3333-4444-555555555555";
    const { send } = endpointAnswering(
      claims(pending, { sub: "ms-sub-2", tid: other, iss: `https://login.microsoftonline.com/${other}/v2.0` }),
    );
    const result = await finishSignIn(organisationId, pending, { code: "c", state: pending.state, redirectUri: REDIRECT }, {}, send);
    expect(result.ok).toBe(false);
  });
});
