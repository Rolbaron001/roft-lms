import { currentTenant } from "@/lib/request";

/**
 * The service worker, served only to a tenant with offline switched on.
 *
 * Written here rather than as a static file so that the same gate applies: for
 * a tenant that has not asked for offline this is a 404, so even a browser that
 * somehow tried to register one would fail, and nothing is cached for anybody.
 *
 * Deliberately conservative about what it holds.
 *
 * It caches the shell and whatever the learner has explicitly asked for, and
 * nothing else. Roland's note of 10 September: "a deliberate download, not a
 * silent cache... Silent caching of everything is how a phone fills up and a
 * learner loses trust in it."
 *
 * It never caches anything that is somebody else's turn - marking, moderation,
 * verification - because those need a second person and a stale copy of one is
 * worse than no copy.
 */
export async function GET() {
  const tenant = await currentTenant();

  if (!tenant?.offlineEnabled) {
    return new Response("Not found.", { status: 404 });
  }

  const source = `
/*
 * Generated per tenant. Do not edit in the browser.
 *
 * Version is in the cache name: changing it retires the old cache on the next
 * activation, which is how a learner stops being served last month's material
 * after an update.
 */
const CACHE = "roft-lms-v1";

/*
 * The shell. Enough to open the app with no signal and be told what is held,
 * rather than meeting a browser error page.
 */
const SHELL = ["/", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

/*
 * Never cached, whatever else happens. Each of these either needs a second
 * person or changes underneath a stale copy in a way that would mislead.
 */
const NEVER = [/\\/assess/, /\\/moderate/, /\\/verify/, /\\/api\\//, /\\/login/];

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((pattern) => pattern.test(url.pathname))) return;

  /*
   * Network first, falling back to whatever is held.
   *
   * The other way round would serve a learner yesterday's page while they are
   * sitting on a signal, which is the wrong trade for a platform whose whole
   * job is to be the current record.
   */
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const held = await caches.match(event.request);
        if (held) return held;
        const shell = await caches.match("/offline");
        if (shell) return shell;
        return new Response("You are offline and this page is not held on the device.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
  );
});
`.trim();

  return new Response(source, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // Never cached itself, so that switching the tenant flag off actually
      // takes effect rather than waiting on a stale worker.
      "cache-control": "no-cache",
      "service-worker-allowed": "/",
    },
  });
}
