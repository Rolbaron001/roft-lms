import { createHmac, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { requirePermission, said } from "@/lib/request";
import { meetingProvider } from "@/lib/meetings";

/**
 * Sending a provider's administrator to connect its Google Meet or Microsoft
 * Teams account (job sheet D41). The same arrangement as connecting a drive
 * (app/api/drive): a random, signed state in a cookie that the callback must
 * match, so a consent begun somewhere else is refused.
 */

export const STATE_COOKIE = "meeting_connect_state";

export function signState(raw: string, service: string): string {
  const mac = createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`meeting:${service}:${raw}`).digest("base64url");
  return `${raw}.${mac}`;
}

export function verifyState(value: string | undefined, cookie: string | undefined, service: string): boolean {
  if (!value || !cookie || value !== cookie) return false;
  const [raw, mac] = value.split(".");
  if (!raw || !mac) return false;
  return signState(raw, service).endsWith(`.${mac}`);
}

export async function GET(_request: Request, { params }: { params: Promise<{ service: string }> }) {
  const { service } = await params;

  // The account every class is created in: the provider's settings, held by
  // whoever manages them.
  await requirePermission("tenant:manage_settings");

  const provider = meetingProvider(service);
  if (!provider) return new Response(await said("No such meeting service."), { status: 404 });
  if (!provider.configured()) {
    return new Response(
      await said(`${provider.label} is not set up on this deployment. Whoever maintains it has to register an application with ${provider.label} and put its client id and secret in the configuration.`),
      { status: 503 },
    );
  }

  const state = signState(randomBytes(24).toString("base64url"), service);
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 600 });

  redirect(provider.consentUrl({ state, redirectUri: await redirectUri(service) }));
}

/**
 * Where the service sends the administrator back to: built from the host the
 * request arrived on, as for the drives, because the platform is multi-tenant
 * by hostname. Each host's address must be registered with the service.
 */
export async function redirectUri(service: string): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const scheme = host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https";
  return `${scheme}://${host}/api/meetings/${service}/callback`;
}
