import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { externalIdentities, signInProviders, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { hintOf, seal, sealingAvailable, unseal } from "./secret-box";
import {
  assertSessionCan,
  openSession,
  type AuthenticatedSession,
  type RequestContext,
  type SignInResult,
} from "./session";

/**
 * Signing in with an organisation's Google or Microsoft account.
 *
 * Job sheet D7, 27 September 2026: out for now on 10 September, brought onto
 * the sheet by Roland on 27 September. Per provider, beside passwords rather
 * than instead of them, and for people who already have an account here: it
 * proves who somebody is, and never creates anybody. A provider still invites
 * its people; this only spares them another password.
 *
 * OpenID Connect's authorization code flow, with PKCE, a state and a nonce.
 * Checked against the published documents on 27 September, not recalled:
 *
 *   - Google's and Microsoft's discovery documents, for the addresses and
 *     issuers below, and for the claims each publishes. Google publishes
 *     `email_verified`; Microsoft does not, so an address from Microsoft is
 *     trusted only when it comes from the directory the provider named.
 *   - OpenID Connect Core 3.1.3.7: an ID token received straight from the
 *     token endpoint may be validated by the TLS connection in place of its
 *     signature, which is how it arrives here. Its issuer, audience, expiry
 *     and nonce are still checked.
 *
 * A person is matched by email the first time and pinned to the provider's
 * own identifier (`sub`) from then on.
 */

export type SsoKind = "google" | "microsoft";
export const SSO_KINDS: SsoKind[] = ["google", "microsoft"];
export const SSO_LABEL: Record<SsoKind, string> = { google: "Google", microsoft: "Microsoft" };

type Endpoints = { authorize: string; token: string; issuers: string[] };

function endpoints(kind: SsoKind, directoryId: string | null): Endpoints {
  if (kind === "google") {
    return {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      // Google's documentation allows either form in `iss`.
      issuers: ["https://accounts.google.com", "accounts.google.com"],
    };
  }
  const directory = directoryId ?? "";
  return {
    authorize: `https://login.microsoftonline.com/${directory}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${directory}/oauth2/v2.0/token`,
    issuers: [`https://login.microsoftonline.com/${directory}/v2.0`],
  };
}

export class SsoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoError";
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const providerInput = z
  .object({
    kind: z.enum(["google", "microsoft"]),
    clientId: z.string().trim().min(1, "The client ID is needed.").max(500),
    /** Blank keeps the secret already held. */
    clientSecret: z.string().trim().max(2000).optional(),
    directoryId: z.string().trim().max(100).optional(),
    allowedDomains: z
      .string()
      .default("")
      .transform((text) =>
        text
          .split(/[\s,;]+/)
          .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
          .filter(Boolean),
      ),
    enabled: z.boolean().default(true),
  })
  .refine((v) => v.kind !== "microsoft" || GUID.test(v.directoryId ?? ""), {
    message:
      "Microsoft needs your organisation's directory (tenant) ID, a code like 72f988bf-86f1-41af-91ab-2d7cd011db47, from the app's Overview page in Microsoft Entra.",
  });

export type SsoProviderView = {
  kind: SsoKind;
  clientId: string;
  secretHint: string;
  directoryId: string | null;
  allowedDomains: string[];
  enabled: boolean;
};

export async function ssoSettingsFor(session: AuthenticatedSession): Promise<SsoProviderView[]> {
  assertSessionCan(session, "tenant:manage_settings");
  return withTenant(session.organisationId, async (tx) =>
    (await tx.select().from(signInProviders)).map((row) => ({
      kind: row.kind as SsoKind,
      clientId: row.clientId,
      secretHint: row.secretHint,
      directoryId: row.directoryId,
      allowedDomains: row.allowedDomains,
      enabled: row.enabled,
    })),
  );
}

export async function saveSsoProvider(session: AuthenticatedSession, input: z.input<typeof providerInput>) {
  assertSessionCan(session, "tenant:manage_settings");
  const parsed = providerInput.parse(input);
  if (parsed.clientSecret && !sealingAvailable()) {
    throw new SsoError("This platform has no key to seal secrets with, so it cannot keep the client secret.");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select({ id: signInProviders.id })
      .from(signInProviders)
      .where(eq(signInProviders.kind, parsed.kind));
    if (!existing && !parsed.clientSecret) throw new SsoError("The client secret is needed to connect.");

    const secret = parsed.clientSecret
      ? { clientSecretSealed: seal(parsed.clientSecret), secretHint: hintOf(parsed.clientSecret) }
      : {};
    const values = {
      clientId: parsed.clientId,
      directoryId: parsed.kind === "microsoft" ? parsed.directoryId!.toLowerCase() : null,
      allowedDomains: parsed.allowedDomains,
      enabled: parsed.enabled,
      updatedAt: new Date(),
      ...secret,
    };
    if (existing) {
      await tx.update(signInProviders).set(values).where(eq(signInProviders.id, existing.id));
    } else {
      await tx.insert(signInProviders).values({
        organisationId: session.organisationId,
        kind: parsed.kind,
        clientSecretSealed: secret.clientSecretSealed!,
        secretHint: secret.secretHint!,
        ...values,
      });
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: existing ? "sso.changed" : "sso.connected",
      entityType: "organisation",
      entityId: session.organisationId,
      after: {
        kind: parsed.kind,
        clientId: parsed.clientId,
        allowedDomains: parsed.allowedDomains,
        enabled: parsed.enabled,
        secretChanged: Boolean(parsed.clientSecret),
      },
    });
  });
}

/** Switches the way of signing in off and forgets its secret. Links made stay, for if it returns. */
export async function removeSsoProvider(session: AuthenticatedSession, kind: SsoKind) {
  assertSessionCan(session, "tenant:manage_settings");
  return withTenant(session.organisationId, async (tx) => {
    await tx.delete(signInProviders).where(eq(signInProviders.kind, kind));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "sso.removed",
      entityType: "organisation",
      entityId: session.organisationId,
      after: { kind },
    });
  });
}

/** Which ways of signing in the sign-in page offers. Nothing secret. */
export async function signInOptions(organisationId: string): Promise<SsoKind[]> {
  return withTenant(organisationId, async (tx) =>
    (
      await tx
        .select({ kind: signInProviders.kind })
        .from(signInProviders)
        .where(eq(signInProviders.enabled, true))
    )
      .map((row) => row.kind as SsoKind)
      .sort(),
  );
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

/** What travels in the browser's cookie between leaving and coming back. */
export type Pending = { kind: SsoKind; state: string; nonce: string; verifier: string };

function mac(payload: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`sso:${payload}`).digest("base64url");
}

/** Signed, so the callback cannot be handed a cookie somebody wrote. */
export function packPending(pending: Pending): string {
  const payload = Buffer.from(JSON.stringify(pending)).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

export function unpackPending(value: string | undefined): Pending | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(mac(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Pending;
  } catch {
    return null;
  }
}

async function providerRow(organisationId: string, kind: SsoKind) {
  return withTenant(organisationId, async (tx) => {
    const [row] = await tx
      .select()
      .from(signInProviders)
      .where(and(eq(signInProviders.kind, kind), eq(signInProviders.enabled, true)));
    return row ?? null;
  });
}

/** Where to send somebody to sign in, and what to remember until they return. */
export async function beginSignIn(
  organisationId: string,
  kind: SsoKind,
  redirectUri: string,
): Promise<{ url: string; pending: Pending }> {
  const row = await providerRow(organisationId, kind);
  if (!row) throw new SsoError(`Signing in with ${SSO_LABEL[kind]} is not switched on here.`);

  const pending: Pending = {
    kind,
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
  };
  const challenge = createHash("sha256").update(pending.verifier).digest("base64url");
  const query = new URLSearchParams({
    client_id: row.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Lets a person with several Google or Microsoft accounts choose which.
    prompt: "select_account",
  });
  return { url: `${endpoints(kind, row.directoryId).authorize}?${query.toString()}`, pending };
}

/** The claims of an ID token, read without its signature: see the header comment. */
function claimsOf(idToken: string): Record<string, unknown> {
  const part = idToken.split(".")[1];
  if (!part) throw new SsoError("The sign-in did not come back with an identity.");
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new SsoError("The sign-in came back with an identity that could not be read.");
  }
}

const REFUSED = "That account cannot sign in here.";

export type SsoResult = SignInResult | { ok: false; reason: "sso"; message: string };

/**
 * Finishes signing in: exchanges the code, checks the identity, and opens a
 * session for the person it belongs to.
 *
 * Every refusal a stranger could learn from says the same thing; the audit
 * log and the server log keep the actual reason for whoever maintains it.
 */
export async function finishSignIn(
  organisationId: string,
  pending: Pending,
  input: { code: string; state: string; redirectUri: string },
  context: RequestContext = {},
  send: typeof fetch = fetch,
  now = new Date(),
): Promise<SsoResult> {
  const refuse = (why: string): SsoResult => {
    console.warn("single sign-on refused", { organisationId, kind: pending.kind, why });
    return { ok: false, reason: "sso", message: REFUSED };
  };

  const stateGiven = Buffer.from(input.state);
  const stateKept = Buffer.from(pending.state);
  if (stateGiven.length !== stateKept.length || !timingSafeEqual(stateGiven, stateKept)) {
    return { ok: false, reason: "sso", message: "That sign-in was not started from this page. Try again." };
  }

  const row = await providerRow(organisationId, pending.kind);
  if (!row) return refuse("provider switched off");
  const secret = unseal(row.clientSecretSealed);
  if (secret === null) return refuse("client secret cannot be opened; enter it again in Settings");

  const where = endpoints(pending.kind, row.directoryId);
  let body: Record<string, unknown>;
  try {
    const response = await send(where.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: row.clientId,
        client_secret: secret,
        code_verifier: pending.verifier,
      }),
    });
    body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return refuse(`token endpoint answered ${response.status}: ${String(body.error_description ?? body.error ?? "")}`);
    }
  } catch (error) {
    return refuse(`token endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof body.id_token !== "string") return refuse("no id_token");
  const claims = claimsOf(body.id_token);

  if (!where.issuers.includes(String(claims.iss))) return refuse(`issuer ${String(claims.iss)}`);
  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud)];
  if (!audience.includes(row.clientId)) return refuse("audience is not this client");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now.getTime()) return refuse("expired");
  if (claims.nonce !== pending.nonce) return refuse("nonce does not match");
  if (typeof claims.sub !== "string" || !claims.sub) return refuse("no subject");

  if (pending.kind === "google" && claims.email_verified !== true) return refuse("Google has not verified the address");
  if (pending.kind === "microsoft" && String(claims.tid ?? "").toLowerCase() !== row.directoryId) {
    return refuse("not from the provider's own directory");
  }

  const email = String(claims.email ?? (pending.kind === "microsoft" ? claims.preferred_username ?? "" : ""))
    .trim()
    .toLowerCase();
  if (!email.includes("@")) return refuse("no address");
  const domain = email.split("@")[1];
  if (row.allowedDomains.length > 0 && !row.allowedDomains.includes(domain)) {
    return refuse(`domain ${domain} not allowed`);
  }

  const subject = claims.sub;
  return withTenant(organisationId, async (tx) => {
    const [linked] = await tx
      .select({ userId: externalIdentities.userId, id: externalIdentities.id })
      .from(externalIdentities)
      .where(and(eq(externalIdentities.provider, pending.kind), eq(externalIdentities.subject, subject)));

    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(linked ? eq(users.id, linked.userId) : eq(users.email, email))
      .limit(1);
    if (!user || user.status !== "active") return refuse(linked ? "linked person not active" : "no active account with that address");

    if (linked) {
      await tx.update(externalIdentities).set({ lastUsedAt: now }).where(eq(externalIdentities.id, linked.id));
    } else {
      // This person already signed in with a different account of the same
      // kind. The first one stays theirs; a second is somebody else's address.
      const [other] = await tx
        .select({ id: externalIdentities.id })
        .from(externalIdentities)
        .where(and(eq(externalIdentities.userId, user.id), eq(externalIdentities.provider, pending.kind)));
      if (other) return refuse("person already linked to another account of this kind");

      await tx.insert(externalIdentities).values({
        organisationId,
        userId: user.id,
        provider: pending.kind,
        subject,
        emailAtLink: email,
        lastUsedAt: now,
      });
      await recordAudit(tx, {
        organisationId,
        actorId: user.id,
        action: "sso.linked",
        entityType: "user",
        entityId: user.id,
        after: { provider: pending.kind, email },
      });
    }

    return openSession(tx, organisationId, user, context, pending.kind);
  });
}
