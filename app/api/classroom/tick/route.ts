import { tokensMatch } from "@/lib/session";
import { classRemindersAllTenants } from "@/lib/classroom-reminders";
import { pendingEmails } from "@/lib/notifications";
import { mailIsConfigured } from "@/lib/mail";
import { deliverQueued } from "@/lib/outbox";

/**
 * The classroom's five-minute run (job sheet D41): the day-before and
 * fifteen-minute reminders, sent at once rather than at the next hourly send.
 * Called by the server's scheduler with CLASSROOM_TICK_SECRET; inside the
 * running application, so it costs a request rather than a new container
 * every five minutes on a small server.
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $CLASSROOM_TICK_SECRET" https://<site>/api/classroom/tick
 */
export async function POST(request: Request) {
  const secret = process.env.CLASSROOM_TICK_SECRET;
  if (!secret) return new Response("Not set up.", { status: 404 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !tokensMatch(given, secret)) return new Response("Not permitted.", { status: 401 });

  const reminders = await classRemindersAllTenants();
  const queued = mailIsConfigured() ? await pendingEmails(200, ["session.announced", "class.reminder", "session.cancelled"]) : [];
  const mail = queued.length ? await deliverQueued(queued) : { sent: 0, failed: 0 };
  return Response.json({ ok: true, reminders, mail });
}
