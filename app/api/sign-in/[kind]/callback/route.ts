import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentTenant, requestContext, said } from "@/lib/request";
import { SESSION_COOKIE } from "@/lib/session";
import { finishSignIn, unpackPending, type SsoKind } from "@/lib/single-sign-on";
import { callbackAddress, PENDING_COOKIE } from "../route";

/**
 * Where Google or Microsoft sends somebody back (job sheet D7).
 *
 * Any failure goes back to the sign-in page with a plain sentence: somebody
 * arriving from another company's website to a bare error would think the
 * platform broken.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const tenant = await currentTenant();
  if (!tenant) return new Response(await said("Not found."), { status: 404 });

  const url = new URL(request.url);
  const jar = await cookies();
  const pending = unpackPending(jar.get(PENDING_COOKIE)?.value);
  // Good once, whatever happens next.
  jar.delete({ name: PENDING_COOKIE, path: "/api/sign-in" });

  if (url.searchParams.get("error")) redirect("/login?sso=cancelled");
  if (!pending || pending.kind !== kind) redirect("/login?sso=expired");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) redirect("/login?sso=expired");

  const result = await finishSignIn(
    tenant.id,
    pending!,
    { code: code!, state: state!, redirectUri: await callbackAddress(kind as SsoKind) },
    await requestContext(),
  );
  if (!result.ok) redirect(result.reason === "sso" && /not started/.test(result.message) ? "/login?sso=expired" : "/login?sso=refused");

  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Matches the session's absolute lifetime in lib/session.ts.
    maxAge: 12 * 60 * 60,
  });
  redirect("/");
}
