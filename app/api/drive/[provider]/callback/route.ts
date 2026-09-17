import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requirePermission } from "@/lib/request";
import {
  driveProviderByName,
  recordConnection,
  type DriveProviderName,
} from "@/lib/drive";
import { redirectUri, STATE_COOKIE, verifyState } from "../connect/route";

/**
 * Where a provider sends somebody back after they consent.
 *
 * Three things have to be true before anything is stored, and the order
 * matters: the person is signed in and entitled, the state matches the cookie
 * this browser was given, and the provider will exchange the code. Checking
 * entitlement last would mean a consent had already been spent.
 *
 * A failure sends somebody back to Settings with a plain sentence rather than
 * rendering an error page, because they are arriving from somebody else's
 * website and a bare error looks like the platform is broken.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: name } = await params;

  const session = await requirePermission("qualification:manage");
  const provider = driveProviderByName(name);
  if (!provider) return new Response("No such drive.", { status: 404 });

  const url = new URL(request.url);
  const jar = await cookies();
  const cookie = jar.get(STATE_COOKIE)?.value;

  // Cleared whatever happens: a state is good once.
  jar.delete(STATE_COOKIE);

  const refused = url.searchParams.get("error");
  if (refused) {
    // "access_denied" is somebody pressing Cancel, which is not a fault.
    redirect(
      `/settings?drive=${refused === "access_denied" ? "cancelled" : "refused"}`,
    );
  }

  const state = url.searchParams.get("state") ?? undefined;
  if (!verifyState(state, cookie, name)) {
    redirect("/settings?drive=state");
  }

  const code = url.searchParams.get("code");
  if (!code) redirect("/settings?drive=nocode");

  try {
    const info = await provider.exchange({
      code: code!,
      redirectUri: await redirectUri(name),
    });

    await recordConnection(session, name as DriveProviderName, info);
  } catch (error) {
    console.error("drive connection failed", {
      provider: name,
      // The message, never the code or any token.
      message: error instanceof Error ? error.message : "unknown",
    });
    redirect("/settings?drive=failed");
  }

  redirect("/settings?drive=connected");
}
