import { currentSession, currentTenant } from "@/lib/request";
import { OfflineError, receiveSubmission } from "@/lib/offline";

/**
 * Where a phone sends what it captured while it had no signal.
 *
 * A route rather than a server action because the sender is a background sync
 * from the device's own queue, not a form somebody submitted. It may run
 * minutes after the learner put the phone in their pocket, and it retries.
 *
 * Idempotent on the device's own key, which is the whole reason the queue can
 * be simple: a phone that uploads, loses signal before hearing the reply and
 * tries again gets the same answer rather than a second copy of the work.
 */
export async function POST(request: Request) {
  const tenant = await currentTenant();

  // Offline is off for everybody who did not ask for it, and that includes
  // this endpoint: it is not reachable at all on an ordinary tenant.
  if (!tenant?.offlineEnabled) {
    return new Response("Not found.", { status: 404 });
  }

  const session = await currentSession();
  if (!session) {
    return Response.json(
      { error: "Sign in first." },
      // 401 rather than a redirect: the caller is a script, and a login page
      // in a fetch response is not something it can do anything with.
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "That is not JSON." }, { status: 400 });
  }

  const items = Array.isArray(body) ? body : [body];

  if (items.length > 50) {
    return Response.json(
      {
        error:
          "Too many at once. Send them in batches of fifty so a failure loses one batch rather than a fortnight.",
      },
      { status: 400 },
    );
  }

  /**
   * Each item answered separately.
   *
   * One bad item in a batch must not throw away the other forty-nine, because
   * the forty-nine are a fortnight of somebody's work. The device reads the
   * results and clears only what was accepted.
   */
  const results: {
    deviceKey: string;
    ok: boolean;
    id?: string;
    error?: string;
    retry?: boolean;
  }[] = [];

  for (const item of items) {
    const deviceKey =
      typeof item === "object" && item && "deviceKey" in item
        ? String((item as { deviceKey: unknown }).deviceKey)
        : "";

    try {
      const saved = await receiveSubmission(
        session,
        item as Parameters<typeof receiveSubmission>[1],
      );
      results.push({ deviceKey, ok: true, id: saved.id });
    } catch (error) {
      if (error instanceof OfflineError) {
        results.push({
          deviceKey,
          ok: false,
          error: error.message,
          /**
           * Whether the device should keep it and try again.
           *
           * A rule refusal will refuse forever, so holding it on the phone for
           * a fortnight helps nobody - the learner is told and the item is
           * dropped. Anything else might be temporary.
           */
          retry: error.reason !== "not_allowed" && error.reason !== "invalid",
        });
        continue;
      }

      results.push({
        deviceKey,
        ok: false,
        error: "The server could not take that one.",
        retry: true,
      });
    }
  }

  return Response.json({ results });
}
