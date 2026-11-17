"use client";

import { useEffect } from "react";

/**
 * When a page fails in the browser: what to do next, and a report to the
 * server log so the cause can be found (see app/api/client-error/route.ts).
 *
 * Plain English rather than translated text, because the translation layer
 * may be what failed. Replaces the framework's bare "This page couldn't load",
 * which said nothing about whether the work just done had been saved
 * (Roland, 17 November 2026: it had been, both times).
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: location.pathname, message: error.message, digest: error.digest, stack: error.stack }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-lg font-semibold">This page could not be shown</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        What you did before this may well have been saved: a commit, an upload or a build finishes on the server even when the page
        after it fails. Reload the page, or go back and open the qualification to see what is there.
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => location.reload()} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white">
          Reload
        </button>
        <button type="button" onClick={() => history.back()} className="rounded-md border border-[var(--border)] px-4 py-2 text-sm">
          Back
        </button>
        <button type="button" onClick={() => reset()} className="rounded-md border border-[var(--border)] px-4 py-2 text-sm">
          Try again
        </button>
      </div>
      <p className="mt-6 text-xs text-[var(--muted)]">The fault has been recorded for the platform&rsquo;s developers.</p>
    </div>
  );
}
