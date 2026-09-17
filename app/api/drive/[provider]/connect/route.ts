import { createHmac, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { requirePermission } from "@/lib/request";
import { driveProviderByName } from "@/lib/drive";

/**
 * Sending somebody to consent to a drive connection.
 *
 * The `state` is what stops somebody being walked into connecting their drive
 * to a page they did not open. It is a random value put in a cookie and sent
 * to the provider; the callback only accepts a consent whose state matches the
 * cookie, so a consent that began somewhere else has nothing to match against.
 *
 * Signed as well as random, so that the callback can tell which provider a
 * state belongs to without a second cookie, and cannot be made to accept a
 * state somebody wrote themselves.
 */

export const STATE_COOKIE = "drive_connect_state";

export function signState(raw: string, provider: string): string {
  const secret = process.env.AUTH_SECRET ?? "";
  const mac = createHmac("sha256", secret)
    .update(`${provider}:${raw}`)
    .digest("base64url");
  return `${raw}.${mac}`;
}

export function verifyState(
  value: string | undefined,
  cookie: string | undefined,
  provider: string,
): boolean {
  if (!value || !cookie || value !== cookie) return false;

  const [raw, mac] = value.split(".");
  if (!raw || !mac) return false;

  return signState(raw, provider).endsWith(`.${mac}`);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: name } = await params;

  // Connecting a drive is part of getting material into a qualification, so it
  // is held by the people who do that rather than by everybody.
  await requirePermission("qualification:manage");

  const provider = driveProviderByName(name);
  if (!provider) {
    return new Response("No such drive.", { status: 404 });
  }

  if (!provider.configured()) {
    return new Response(
      `${provider.label} is not set up on this deployment. Whoever maintains it has to register an application with ${provider.label} and put its client id and secret in the configuration.`,
      { status: 503 },
    );
  }

  const raw = randomBytes(24).toString("base64url");
  const state = signState(raw, name);

  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    // Long enough to read a consent screen, short enough not to linger.
    maxAge: 600,
  });

  redirect(provider.consentUrl({ state, redirectUri: await redirectUri(name) }));
}

/**
 * Where the provider sends somebody back to.
 *
 * Built from the host the request arrived on rather than configured, because
 * the platform is multi-tenant by hostname and a fixed address would send
 * every tenant's consent back to one of them. It must match what is registered
 * with the provider exactly, which is why it is derived in one place and used
 * by both routes.
 */
export async function redirectUri(provider: string): Promise<string> {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const scheme = host.startsWith("localhost") || host.includes(".localhost")
    ? "http"
    : "https";

  return `${scheme}://${host}/api/drive/${provider}/callback`;
}
