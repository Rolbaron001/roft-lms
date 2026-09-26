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
 * The code a page needs to run: the scripts and styles Next.js builds, each
 * named by its content and never changed once built. Held apart from the
 * material, in its own cache, because it is not the learner's and says nothing
 * about them, and without it a held page opens but nothing on it works: not
 * the list of what is held, and not the form that records work with no signal.
 * Replaced whole when the platform is updated.
 */
const CODE = "roft-lms-code-v1";
const IS_CODE = /^\\/_next\\/static\\//;

/*
 * The shell. Enough to open the app with no signal and be told what is held,
 * rather than meeting a browser error page. Held with the code it needs.
 */
const SHELL = ["/", "/offline"];

/* The code a page of HTML asks for, read out of the page itself. */
function codeIn(html) {
  return [...new Set([...html.matchAll(/(\\/_next\\/static\\/[^"'\\s)\\\\]+)/g)].map((m) => m[1]))];
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      const code = await caches.open(CODE);
      for (const path of SHELL) {
        const held = await cache.match(path);
        if (!held) continue;
        const wanted = codeIn(await held.clone().text());
        await Promise.all(wanted.map((url) => code.add(url).catch(() => undefined)));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== CACHE && name !== CODE).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/*
 * Never cached, whatever else happens. Each of these either needs a second
 * person or changes underneath a stale copy in a way that would mislead.
 */
const NEVER = [/\\/assess/, /\\/moderate/, /\\/verify/, /\\/login/];

/*
 * Addresses under /api that are material a learner can take with them: a
 * lesson's file, and a programme document. Every other /api address is an
 * action or somebody else's business, and is never answered from a copy.
 */
const MATERIAL_API = [/^\\/api\\/lessons\\/[^/]+\\/media$/, /^\\/api\\/programme-documents\\/[^/]+$/];

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((pattern) => pattern.test(url.pathname))) return;
  if (url.pathname.startsWith("/api/") && !MATERIAL_API.some((p) => p.test(url.pathname))) return;

  /*
   * Code: from the device when held, since it never changes once built, and
   * kept once fetched so that whatever the learner took offline can run.
   */
  if (IS_CODE.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(
        (held) =>
          held ??
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CODE).then((cache) => cache.put(event.request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  /*
   * Network first, falling back to whatever is held.
   *
   * The other way round would serve a learner yesterday's page while they are
   * sitting on a signal, which is the wrong trade for a platform whose whole
   * job is to be the current record.
   *
   * A fresh copy replaces a held one, so what the learner took with them stays
   * current while they have a signal. Nothing is held that was not asked for:
   * until 26 September every page a learner opened was stored as well, which
   * is the silent caching Roland ruled out on 10 September.
   */
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE);
          if (await cache.match(event.request)) {
            await cache.put(event.request, response.clone());
          }
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
