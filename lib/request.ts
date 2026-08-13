import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  resolveSession,
  SESSION_COOKIE,
  type AuthenticatedSession,
  type RequestContext,
} from "./session";
import { preferredHost, resolveTenant, type TenantIdentity } from "./tenant";
import type { Permission } from "./rbac";

/**
 * Request-scoped helpers. Everything a page or action needs to know about who
 * is asking and which client they belong to comes from here, so no route has
 * to reimplement the checks.
 */

export async function requestContext(): Promise<RequestContext> {
  const headerList = await headers();
  // The first entry of x-forwarded-for is the client; the rest are proxies.
  const forwarded = headerList.get("x-forwarded-for");
  return {
    ipAddress:
      forwarded?.split(",")[0]?.trim() ??
      headerList.get("x-real-ip") ??
      null,
    userAgent: headerList.get("user-agent"),
  };
}

/** The tenant this hostname belongs to, or null on the platform console. */
export async function currentTenant(): Promise<TenantIdentity | null> {
  const headerList = await headers();
  const host = preferredHost(
    headerList.get("host"),
    headerList.get("x-forwarded-host"),
  );
  if (!host) return null;
  return resolveTenant(host);
}

/** The tenant, or a 404 if the hostname matches none. */
export async function requireTenant(): Promise<TenantIdentity> {
  const tenant = await currentTenant();
  if (!tenant) {
    redirect("/unknown-tenant");
  }
  return tenant;
}

/** The signed-in session, or null. */
export async function currentSession(): Promise<AuthenticatedSession | null> {
  const tenant = await currentTenant();
  if (!tenant) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return resolveSession(tenant.id, token);
}

/** The signed-in session, or a redirect to the tenant's login page. */
export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await currentSession();
  if (!session) {
    redirect("/login");
  }

  // A password somebody else chose gets one use: the one that sets a new one.
  // Enforced here rather than on each page, because a rule about what an
  // account may reach is only worth having if it cannot be walked around by
  // typing a different address.
  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  return session;
}

/**
 * The signed-in session, without the forced-password-change redirect.
 *
 * Only the change-password page itself may use this. Anything else calling it
 * reopens the hole the redirect above closes.
 */
export async function requireSessionForPasswordChange(): Promise<AuthenticatedSession> {
  const session = await currentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * The signed-in session, provided it holds the permission.
 *
 * This is the check every protected page and action should call. It refuses
 * rather than redirecting, because a signed-in person reaching a page they are
 * not entitled to see is a different situation from not being signed in — and
 * quietly bouncing them to a login form they have already passed is confusing.
 */
export async function requirePermission(
  permission: Permission,
): Promise<AuthenticatedSession> {
  const session = await requireSession();
  if (!session.permissions.includes(permission)) {
    redirect("/not-permitted");
  }
  return session;
}
