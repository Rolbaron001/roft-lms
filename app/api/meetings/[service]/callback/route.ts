import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requirePermission, said } from "@/lib/request";
import { meetingProvider, recordMeetingConnection } from "@/lib/meetings";
import { redirectUri, STATE_COOKIE, verifyState } from "../connect/route";

/**
 * Where Google or Microsoft sends the administrator back after consenting.
 * Signed in and entitled, the state matching this browser's cookie, and the
 * code exchanged, in that order, before anything is stored. A failure returns
 * to Settings with a sentence rather than an error page.
 */
export async function GET(request: Request, { params }: { params: Promise<{ service: string }> }) {
  const { service } = await params;

  const session = await requirePermission("tenant:manage_settings");
  const provider = meetingProvider(service);
  if (!provider) return new Response(await said("No such meeting service."), { status: 404 });

  const url = new URL(request.url);
  const jar = await cookies();
  const cookie = jar.get(STATE_COOKIE)?.value;
  // A state is good once.
  jar.delete(STATE_COOKIE);

  const back = (outcome: string) => `/settings?meeting=${outcome}#classroom`;

  const refused = url.searchParams.get("error");
  if (refused) redirect(back(refused === "access_denied" ? "cancelled" : "refused"));

  if (!verifyState(url.searchParams.get("state") ?? undefined, cookie, service)) redirect(back("state"));

  const code = url.searchParams.get("code");
  if (!code) redirect(back("failed"));

  try {
    const tokens = await provider.exchange({ code: code!, redirectUri: await redirectUri(service) });
    await recordMeetingConnection(session, provider.name, tokens);
  } catch (error) {
    console.error("meeting account not connected", {
      service,
      // The message, never the code or a token.
      message: error instanceof Error ? error.message : "unknown",
    });
    redirect(back("failed"));
  }

  redirect(back("connected"));
}
