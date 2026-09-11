"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * What this phone is actually holding, read from the browser itself.
 *
 * Rendered in the browser rather than on the server because the server has no
 * idea: the cache belongs to the device. It also has to work with no signal,
 * since this is the page the service worker falls back to.
 *
 * Roland's note of 10 September: "They can see what is held and how much room
 * it takes. Silent caching of everything is how a phone fills up and a learner
 * loses trust in it."
 */
type Held = { count: number; bytes: number; quota: number | null };

function readable(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Subscribes to the browser's own online and offline events. */
function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function HeldOnDevice() {
  const [held, setHeld] = useState<Held | null>(null);
  const [supported, setSupported] = useState(true);

  /**
   * Whether there is a signal, read from the browser rather than mirrored into
   * React state. Mirroring it meant setting state synchronously inside an
   * effect, which React now warns about - and it would have rendered
   * "connected" on the server for a learner who is not.
   */
  const online = useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    // On the server there is no navigator; assume connected, which is what the
    // page says before it is corrected a moment later in the browser.
    () => true,
  );

  useEffect(() => {
    async function measure() {
      if (!("caches" in window)) {
        setSupported(false);
        return;
      }

      try {
        const names = await caches.keys();
        let count = 0;
        let bytes = 0;

        for (const name of names) {
          const cache = await caches.open(name);
          const entries = await cache.keys();
          count += entries.length;

          // Measured rather than estimated per entry, because a learner
          // deciding whether they have room needs a real number.
          for (const entry of entries) {
            const response = await cache.match(entry);
            if (!response) continue;
            const blob = await response.clone().blob();
            bytes += blob.size;
          }
        }

        // What the browser will let this site keep, where it will say.
        let quota: number | null = null;
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();
          quota = estimate.quota ?? null;
        }

        setHeld({ count, bytes, quota });
      } catch {
        // A device that will not answer is not an error worth showing a
        // learner; they simply see nothing held.
        setSupported(false);
      }
    }

    measure();
  }, []);

  async function makePersistent() {
    // Asks Android to stop evicting this site under storage pressure. Heidi
    // said a fortnight between connections, and a cache cleared on day three
    // would make the whole thing pointless.
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  }

  if (!supported) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <p className="text-sm text-[var(--muted)]">
          This browser cannot hold material for use without a signal. Everything
          still works normally while you are connected.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Held on this phone</h2>
        <span className="text-xs text-[var(--muted)]">
          {online ? "Connected" : "No signal — showing what is held"}
        </span>
      </div>

      {held === null ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Checking…</p>
      ) : held.count === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">
          Nothing is held yet. Open a study unit and choose to make it available
          offline before you go out.
        </p>
      ) : (
        <p className="mt-2 text-sm">
          {held.count} {held.count === 1 ? "item" : "items"} ·{" "}
          {readable(held.bytes)}
          {held.quota
            ? ` of about ${readable(held.quota)} this phone will allow`
            : ""}
        </p>
      )}

      <button
        type="button"
        onClick={makePersistent}
        className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
      >
        Keep this on the phone
      </button>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Asks the phone not to clear it while you are away.
      </p>
    </div>
  );
}
