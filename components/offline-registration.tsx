"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and only where a tenant asked for one.
 *
 * Rendered by the shell for an offline-enabled tenant and not rendered at all
 * for anybody else, so there is no code path in which an ordinary tenant's
 * learner registers anything. The server refuses to serve `/sw.js` to them as
 * well - two gates, because this is the constraint Roland was most explicit
 * about and a single check is a single thing to get wrong.
 *
 * Deliberately silent on failure. A learner who cannot install the worker -
 * private browsing, an old browser, a locked-down device - should still have a
 * working online platform, and an error about a service worker would mean
 * nothing to them.
 */
export function OfflineRegistration() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let cancelled = false;

    // After load rather than during it: registration competes with the first
    // render for the same connection, and the page matters more.
    const register = () => {
      if (cancelled) return;
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Nothing to tell the learner. See above.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
