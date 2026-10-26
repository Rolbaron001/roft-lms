import { tokensMatch } from "@/lib/session";
import { receiveTranscript } from "@/lib/classroom-record";
import { transcriberConfigured } from "@/lib/classroom-transcriber";

/**
 * The transcriber's answer for a class (job sheet D41, phase B), from the
 * media server, signed with TRANSCRIBER_SECRET. Like the media server's own
 * reports it belongs to no provider's address: the job names the class.
 */
export async function POST(request: Request) {
  if (!transcriberConfigured()) return new Response("Not set up.", { status: 404 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !tokensMatch(given, process.env.TRANSCRIBER_SECRET ?? "")) return new Response("Not permitted.", { status: 401 });

  const body = (await request.json().catch(() => null)) as Parameters<typeof receiveTranscript>[0] | null;
  if (!body || typeof body.job !== "string" || (body.status !== "done" && body.status !== "failed")) {
    return new Response("Not a transcript.", { status: 400 });
  }
  const filed = await receiveTranscript({
    job: body.job,
    status: body.status,
    segments: Array.isArray(body.segments)
      ? body.segments.map((one) => ({ speaker: String(one.speaker), startedAt: String(one.startedAt), endedAt: String(one.endedAt), text: String(one.text) }))
      : [],
    error: typeof body.error === "string" ? body.error : undefined,
  });
  return filed ? new Response("Filed.") : new Response("Unknown class.", { status: 404 });
}
