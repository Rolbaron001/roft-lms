"use client";

import { useEffect } from "react";

/**
 * The last resort, when the layout itself failed: its own page, since nothing
 * of the app's can be relied on. Reports to the server log as app/error.tsx does.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: location.pathname, message: error.message, digest: error.digest, stack: error.stack, global: true }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en-GB">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#fff", color: "#222", margin: 0 }}>
        <div style={{ maxWidth: 560, margin: "64px auto", padding: "0 16px" }}>
          <h1 style={{ fontSize: 18 }}>This page could not be shown</h1>
          <p style={{ fontSize: 14, color: "#555" }}>
            What you did before this may well have been saved: a commit, an upload or a build finishes on the server even when the page
            after it fails. Reload the page, or go back and open the qualification to see what is there.
          </p>
          <button type="button" onClick={() => location.reload()} style={{ padding: "8px 16px", marginRight: 8 }}>
            Reload
          </button>
          <button type="button" onClick={() => history.back()} style={{ padding: "8px 16px" }}>
            Back
          </button>
          <p style={{ fontSize: 12, color: "#777", marginTop: 24 }}>The fault has been recorded for the platform&rsquo;s developers.</p>
        </div>
      </body>
    </html>
  );
}
