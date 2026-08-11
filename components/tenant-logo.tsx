/**
 * A tenant's logo.
 *
 * Rendered with a plain <img> rather than next/image on purpose. next/image
 * would have the server fetch the address to optimise it, and that address is
 * supplied by a tenant — so the platform would be making outbound requests to
 * wherever a client typed, from inside our network. A plain tag makes the
 * browser fetch it instead, which is the browser's ordinary business.
 *
 * Falls back to the organisation's name whenever there is no logo, the address
 * is broken, or the image simply fails to load. A header that collapses to
 * nothing because a client's logo moved is worse than one that never had it.
 */
"use client";

import { useState } from "react";

export function TenantLogo({
  logoUrl,
  displayName,
  className = "",
  height = 32,
}: {
  logoUrl: string | null;
  displayName: string;
  className?: string;
  /** Pixels. Width is left free so the aspect ratio survives. */
  height?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!logoUrl || failed) {
    return (
      <span className={`text-base font-semibold ${className}`}>
        {displayName}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={displayName}
      style={{ height, width: "auto", maxWidth: "16rem" }}
      className={`object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
