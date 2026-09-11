import { currentTenant } from "@/lib/request";

/**
 * The web app manifest, which is what makes the site installable.
 *
 * Served only to a tenant with offline switched on. For everybody else this is
 * a 404 and the browser never offers to install anything - which is Roland's
 * constraint of 10 September applied at the first possible point: "invisible to
 * every tenant that does not turn it on".
 *
 * Android was Heidi's answer, and it removes the largest risk. Chrome on
 * Android does not evict an installed site's storage the way iOS Safari does,
 * so a fortnight in the field does not need a native app and a second codebase.
 */
export async function GET() {
  const tenant = await currentTenant();

  if (!tenant?.offlineEnabled) {
    return new Response("Not found.", { status: 404 });
  }

  const manifest = {
    name: `${tenant.displayName} — Learning`,
    short_name: tenant.displayName.slice(0, 12),
    description: "Study material, the rollout schedule, and work you can record with no signal.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: tenant.primaryColour ?? "#1f2937",
    icons: tenant.logoUrl
      ? [
          {
            src: tenant.logoUrl,
            sizes: "any",
            // No purpose: "maskable" claim. The logo is the provider's own and
            // has no safe zone, so Android would crop it badly.
            type: "image/png",
          },
        ]
      : [],
  };

  return Response.json(manifest, {
    headers: {
      "content-type": "application/manifest+json",
      // Short, so switching the flag off takes effect the same day rather than
      // whenever a phone next decides to revalidate.
      "cache-control": "public, max-age=300",
    },
  });
}
