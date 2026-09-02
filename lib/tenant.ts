import { eq, or } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations } from "@/db/schema";

/**
 * Working out which client a request belongs to.
 *
 * This necessarily happens before anyone has signed in — the login page itself
 * has to carry the right client's branding — so it is one of the few lookups
 * that runs outside tenant scope. It reads nothing but the organisations table
 * and returns nothing but that tenant's public identity.
 *
 *   lms.roftbusiness.org      the ROFT platform console
 *   acme.roftbusiness.org     the tenant whose slug is "acme"
 *   learning.acme.com         the tenant whose custom domain this is
 *
 * In development the same shapes work against localhost: `localhost:3000` is
 * the platform console and `acme.localhost:3000` is that tenant. Browsers
 * resolve any *.localhost name to the loopback address without configuration.
 */

export type TenantIdentity = {
  id: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  signInGraphicUrl: string | null;
  strapline: string | null;
  primaryColour: string;
  accentColour: string;
  /** The provider's own clock, as an IANA zone name. */
  timezone: string;
  status: (typeof organisations.$inferSelect)["status"];
};

export type HostResolution =
  | { kind: "platform" }
  | { kind: "tenant_slug"; slug: string }
  | { kind: "custom_domain"; domain: string };

/**
 * Picks the hostname the browser actually asked for.
 *
 * `host` is not reliable on its own. Next.js rewrites it to the server's own
 * address on the request that follows a form submission, and any reverse proxy
 * — which is how this will be deployed — does the same, putting the real
 * hostname in `x-forwarded-host`. Reading `host` alone makes the tenant vanish
 * mid-flow.
 *
 * Trusting a client-supplied header needs justifying. It is safe here because
 * this only decides which tenant's login page and branding to show: sessions
 * and credentials are checked against that tenant's own records, so claiming a
 * different hostname gets an attacker no further than typing that hostname
 * into their address bar would. In deployment the proxy must be configured to
 * overwrite `x-forwarded-host` rather than pass a client's copy through.
 */
export function preferredHost(
  hostHeader: string | null,
  forwardedHostHeader: string | null,
): string | null {
  // A chain of proxies appends; the first entry is the original request.
  const forwarded = forwardedHostHeader?.split(",")[0]?.trim();
  return forwarded || hostHeader || null;
}

function stripPort(host: string): string {
  // IPv6 literals arrive bracketed; everything else splits on the last colon.
  if (host.startsWith("[")) {
    return host.slice(0, host.indexOf("]") + 1).toLowerCase();
  }
  const colon = host.lastIndexOf(":");
  return (colon === -1 ? host : host.slice(0, colon)).toLowerCase();
}

/**
 * Decides, from the hostname alone, whether a request is for the platform
 * console, a tenant subdomain, or a tenant's own domain. No database access:
 * this is pure string handling so it can run anywhere, including middleware.
 */
export function resolveHost(
  host: string,
  platformHost = process.env.PLATFORM_HOST ?? "localhost:3000",
): HostResolution {
  const hostname = stripPort(host);
  const platformHostname = stripPort(platformHost);

  if (hostname === platformHostname) {
    return { kind: "platform" };
  }

  // A subdomain of the platform host identifies a tenant by slug.
  if (hostname.endsWith(`.${platformHostname}`)) {
    const slug = hostname.slice(0, -(platformHostname.length + 1));
    // Only a single label is a tenant slug; anything deeper is not ours.
    if (slug && !slug.includes(".")) {
      return { kind: "tenant_slug", slug };
    }
  }

  // Bare `foo.localhost` in development, where PLATFORM_HOST is `localhost`.
  if (hostname.endsWith(".localhost")) {
    const slug = hostname.slice(0, -".localhost".length);
    if (slug && !slug.includes(".")) {
      return { kind: "tenant_slug", slug };
    }
  }

  return { kind: "custom_domain", domain: hostname };
}

/**
 * Short-lived cache. A tenant's identity changes rarely and this lookup sits
 * in front of every single request, including unauthenticated ones, which
 * makes it the easiest thing on the platform to hammer.
 *
 * A hostname that matched nothing is cached for only a few seconds. Caching a
 * miss for as long as a hit would leave a newly provisioned tenant answering
 * "this address is not in use" for a minute after it was created — the worst
 * possible moment to look broken. The short window still absorbs a flood of
 * requests to a hostname that does not exist.
 */
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 3_000;
const cache = new Map<string, { value: TenantIdentity | null; expiresAt: number }>();

export function clearTenantCache(): void {
  cache.clear();
}

/**
 * Resolves a hostname to a tenant, or null for the platform console and for
 * hostnames that match no tenant.
 */
export async function resolveTenant(
  host: string,
): Promise<TenantIdentity | null> {
  const resolution = resolveHost(host);

  // The platform host resolves to ROFT's own organisation.
  //
  // ROFT is a tenant like any other — it has users, roles and sessions — and
  // treating it as one means the Platform Owner signs in through exactly the
  // same path as everybody else, rather than needing a second, less-tested
  // way in. What separates them is the permissions they hold, not a special
  // door.
  const key =
    resolution.kind === "platform"
      ? `slug:${process.env.PLATFORM_ORG_SLUG ?? "roft"}`
      : resolution.kind === "tenant_slug"
        ? `slug:${resolution.slug}`
        : `domain:${resolution.domain}`;

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await withPlatformScope(
    "resolving a hostname to a tenant, which happens before any sign-in",
    async (tx) => {
      const [row] = await tx
        .select({
          id: organisations.id,
          slug: organisations.slug,
          displayName: organisations.displayName,
          logoUrl: organisations.logoUrl,
          signInGraphicUrl: organisations.signInGraphicUrl,
          strapline: organisations.strapline,
          primaryColour: organisations.primaryColour,
          accentColour: organisations.accentColour,
          timezone: organisations.timezone,
          status: organisations.status,
        })
        .from(organisations)
        .where(
          resolution.kind === "platform"
            ? eq(organisations.slug, process.env.PLATFORM_ORG_SLUG ?? "roft")
            : resolution.kind === "tenant_slug"
              ? eq(organisations.slug, resolution.slug)
              : or(
                  eq(organisations.customDomain, resolution.domain),
                  eq(organisations.customDomain, `www.${resolution.domain}`),
                ),
        )
        .limit(1);

      return row ?? null;
    },
  );

  // A suspended or closed tenant resolves to nothing, so its people cannot
  // reach a login form at all.
  const usable = value && value.status === "active" ? value : null;

  cache.set(key, {
    value: usable,
    expiresAt: Date.now() + (usable ? HIT_TTL_MS : MISS_TTL_MS),
  });
  return usable;
}
