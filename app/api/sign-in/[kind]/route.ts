import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentTenant } from "@/lib/request";
import { beginSignIn, packPending, SSO_KINDS, SsoError, type SsoKind } from "@/lib/single-sign-on";

/**
 * Sending somebody to sign in with Google or Microsoft (job sheet D7).
 *
 * What has to survive the round trip, the state, the nonce and the PKCE
 * verifier, goes in a signed cookie of this browser's own, so a sign-in begun
 * anywhere else has nothing to match when it comes back.
 */

export const PENDING_COOKIE = "sso_pending";

/**
 * Where the provider sends somebody back to. From the host the request came
 * in on, since each provider's platform lives at its own address; it has to
 * match what the provider registered exactly, and Settings shows it to copy.
 */
export async function callbackAddress(kind: SsoKind): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const scheme = host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https";
  return `${scheme}://${host}/api/sign-in/${kind}/callback`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const tenant = await currentTenant();
  if (!tenant || !SSO_KINDS.includes(kind as SsoKind)) {
    return new Response("Not found.", { status: 404 });
  }

  let url: string;
  try {
    const begun = await beginSignIn(tenant.id, kind as SsoKind, await callbackAddress(kind as SsoKind));
    const jar = await cookies();
    jar.set(PENDING_COOKIE, packPending(begun.pending), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/sign-in",
      // Long enough to choose an account, short enough not to linger.
      maxAge: 600,
    });
    url = begun.url;
  } catch (error) {
    if (error instanceof SsoError) redirect("/login?sso=off");
    throw error;
  }
  redirect(url);
}
