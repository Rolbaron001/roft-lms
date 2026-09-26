"use client";

import { useEffect, useState } from "react";

/**
 * "Make this available offline" — a deliberate download, not a silent cache.
 *
 * Roland's note of 10 September: "Before going out, the learner taps 'make this
 * available offline' for their current study unit. They can see what is held
 * and how much room it takes. Silent caching of everything is how a phone fills
 * up and a learner loses trust in it."
 *
 * So this fetches the named pages and puts them in the same cache the service
 * worker reads from. Nothing is held that the learner did not ask for.
 *
 * It refuses to start a download it cannot finish, rather than filling the
 * phone and failing halfway - which is the failure that would cost somebody
 * their fortnight.
 */
export function TakeOffline({
  label,
  paths,
}: {
  /** What the learner is choosing to keep, in their words. */
  label: string;
  /** The pages that make it up. */
  paths: string[];
}) {
  const [state, setState] = useState<
    "unknown" | "held" | "not_held" | "working" | "unsupported"
  >("unknown");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    /**
     * Held only if every page of it is. A study unit missing its third page is
     * not available offline, and saying it is would be the worst outcome here.
     *
     * Declared inside the effect so the state change arrives in the cache's
     * own callback rather than synchronously in the effect body.
     */
    async function check() {
      if (typeof caches === "undefined") {
        if (live) setState("unsupported");
        return;
      }
      try {
        const found = await Promise.all(
          paths.map((path) => caches.match(path)),
        );
        if (live) setState(found.every(Boolean) ? "held" : "not_held");
      } catch {
        if (live) setState("unsupported");
      }
    }

    check();
    return () => {
      live = false;
    };
  }, [paths]);

  async function take() {
    setState("working");
    setMessage(null);

    try {
      /**
       * Ask for room first.
       *
       * `estimate` is approximate and browsers deliberately fuzz it, so this is
       * a sanity check rather than a guarantee - but it catches the phone that
       * is already nearly full, which is the common case.
       */
      if (navigator.storage?.estimate) {
        const { quota, usage } = await navigator.storage.estimate();
        const free = (quota ?? 0) - (usage ?? 0);
        // A rough page with its images. Better to refuse early than to fill
        // the phone and fail on the last one.
        const needed = paths.length * 512 * 1024;

        if (quota && free < needed) {
          setState("not_held");
          setMessage(
            "There is not enough room on this phone. Remove something held for another study unit first — nothing has been downloaded.",
          );
          return;
        }
      }

      // Ask the phone not to clear it while the learner is away. A fortnight
      // is long enough for Android to reclaim storage under pressure.
      await navigator.storage?.persist?.();

      const cache = await caches.open("roft-lms-v1");
      await cache.addAll(paths);

      /*
       * And the code those pages need to run, read out of the pages
       * themselves. Until 26 September only the pages were kept, so a held
       * page opened with no signal but nothing on it worked. Kept in the
       * service worker's code cache (app/sw.js); if any of it cannot be
       * fetched, the pages are released again rather than half held.
       */
      try {
        const code = await caches.open("roft-lms-code-v1");
        const wanted = new Set<string>();
        for (const path of paths) {
          const held = await cache.match(path);
          const type = held?.headers.get("content-type") ?? "";
          if (!held || !type.includes("text/html")) continue;
          // Backslashes excluded: the page also carries the same addresses
          // inside escaped text, and taking the escape along makes a second,
          // wrong address for every file.
          for (const match of (await held.text()).matchAll(/(\/_next\/static\/[^"'\s)\\]+)/g)) {
            wanted.add(match[1]);
          }
        }
        await code.addAll([...wanted]);
      } catch (error) {
        await Promise.all(paths.map((path) => cache.delete(path)));
        throw error;
      }

      setState("held");
      setMessage(`${label} is on this phone. You can read it with no signal.`);
    } catch {
      setState("not_held");
      setMessage(
        "That did not download completely, so none of it has been kept. Try again where the signal is better.",
      );
    }
  }

  async function release() {
    const cache = await caches.open("roft-lms-v1");
    await Promise.all(paths.map((path) => cache.delete(path)));
    setState("not_held");
    setMessage(`${label} is no longer held. It freed up room on this phone.`);
  }

  if (state === "unsupported") {
    return (
      <p className="text-sm text-[var(--muted)]">
        This browser cannot keep material for use without a signal.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {state === "held" ? (
        <button
          type="button"
          onClick={release}
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
        >
          Remove from this phone
        </button>
      ) : (
        <button
          type="button"
          onClick={take}
          disabled={state === "working"}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {state === "working"
            ? "Downloading…"
            : "Make this available offline"}
        </button>
      )}

      <p className="text-xs text-[var(--muted)]">
        {state === "held"
          ? `${label} is held on this phone.`
          : `${paths.length} ${paths.length === 1 ? "page" : "pages"}. Download it before you go out.`}
      </p>

      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}
