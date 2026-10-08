import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  resolveSession,
  SESSION_COOKIE,
  type AuthenticatedSession,
  type RequestContext,
} from "./session";
import { preferredHost, resolveTenant, type TenantIdentity } from "./tenant";
import { VIEW_AS_COOKIE, viewAsSession } from "./view-as";
import type { Permission } from "./rbac";
import { can, type Capability } from "./features";
import { dateLocale, localeFor } from "./i18n/locales";
import { DEFAULT_DATE_STYLE, dateWriter, deviceLocale, isDateStyle, type DateStyle, type DateWriter } from "./date-format";
import { DEFAULT_TIME_ZONE } from "./timezone";
import { translator, type Translate } from "./i18n";
import { sayer, sayWithin, type Say } from "./i18n/said";

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

/** The person's language, for a page that already holds tenant and session (D9). */
export { localeFor };

/** The same, for a page that holds neither, such as the root layout. */
export async function currentLocale(): Promise<string> {
  const tenant = await currentTenant();
  return localeFor(tenant, tenant ? await currentSession() : null);
}

/**
 * The reader's phrases, for a server page: `const t = await pageT();`. Stage
 * 4 of D9 moves every staff screen over, and a line each is what that costs.
 */
export async function pageT(): Promise<Translate> {
  return translator(await currentLocale());
}

/**
 * Messages the server wrote, in the reader's language (D9 stage 5): for a page
 * showing something lib/ produced, such as a reason a step is closed.
 * `const say = await pageSay(); say(step.blockedBy)`.
 */
export async function pageSay(): Promise<Say> {
  return sayer(await currentLocale());
}

/**
 * A result with its messages in the reader's language (D9 stage 5).
 *
 * Every server action returns through this: `return said({ error: ... })`.
 * A page showing what lib/ worked out passes it through too:
 * `const view = await said(await readinessOf(...))`. A plain string works as
 * well. Only fields with a message's name change (see `sayWithin`), at any depth.
 */
export async function said<T>(value: T): Promise<T> {
  if (value === null || value === undefined) return value;
  return sayWithin(value, sayer(await currentLocale()));
}

/**
 * How dates are written for this reader: the provider's chosen style, months
 * named in the reader's language, instants on the provider's clock, and for
 * the "device" style the reader's own regional setting as their browser
 * reports it. Roland, 8 October 2026. Passed to the browser as `dateSettings`
 * so a component writes dates the same way (components/i18n.tsx, useDay).
 */
export const pageDates = cache(async (): Promise<DateWriter & { settings: DateSettings }> => {
  const tenant = await currentTenant();
  const locale = await currentLocale();
  const settings: DateSettings = {
    style: isDateStyle(tenant?.dateStyle) ? tenant.dateStyle : DEFAULT_DATE_STYLE,
    language: dateLocale(locale),
    device: deviceLocale((await headers()).get("accept-language")),
    timeZone: tenant?.timezone ?? DEFAULT_TIME_ZONE,
  };
  return { ...dateWriter(settings.style, settings.language, settings.device, settings.timeZone), settings };
});

export type DateSettings = { style: DateStyle; language: string; device: string | null; timeZone: string };

/** The reader's language and date format together, for a page that writes dates. */
export async function pageLocale(): Promise<{ t: Translate; locale: string; dates: string } & DateWriter> {
  const locale = await currentLocale();
  const { day, when } = await pageDates();
  return { t: translator(locale), locale, dates: dateLocale(locale), day, when };
}

/**
 * The signed-in session, or null.
 *
 * Once per request while a page renders (React's `cache`), since the root
 * layout asks for the person's language and the page asks for the session
 * (job sheet D9). Outside a render, in an action or a route, it runs each time.
 */
export const currentSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const tenant = await currentTenant();
  if (!tenant) return null;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  // "View as" (lib/view-as.ts): the administrator's own session decides
  // whether it is allowed; the request is read-only from the first query, so
  // the session is not even marked as used.
  const viewAsId = cookieStore.get(VIEW_AS_COOKIE)?.value;
  const real = await resolveSession(tenant.id, token, { touch: !viewAsId });
  if (!real || !viewAsId) return real;
  return (await viewAsSession(real, viewAsId)) ?? real;
});

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
/**
 * Refuses a page belonging to a capability this tenant does not have.
 *
 * Hiding a menu entry is not hiding a feature. Every one of these pages stays
 * reachable by typing the address, by a link in an old email, by a bookmark
 * kept from before somebody switched the capability off. A provider told that
 * statutory reporting is not part of their platform, who can still open the
 * statutory register and see a form, has been told something untrue.
 *
 * `notFound` rather than `/not-permitted`: the two say different things, and
 * the difference matters. "You may not" invites somebody to ask for the right.
 * The honest answer here is that the page is not part of this platform at all.
 */
export async function requireCapability(
  capability: Capability,
): Promise<TenantIdentity> {
  const tenant = await requireTenant();
  if (!can(tenant.featureFlags, capability)) {
    notFound();
  }
  return tenant;
}

export async function requirePermission(
  permission: Permission,
): Promise<AuthenticatedSession> {
  const session = await requireSession();
  if (!session.permissions.includes(permission)) {
    redirect("/not-permitted");
  }
  return session;
}

/**
 * The signed-in session, provided it holds any one of these.
 *
 * For a page several roles reach for different reasons. The curriculum is the
 * case that prompted it: a facilitator, an assessor and a moderator all need
 * to see what a module requires, and gating that page on the permission to
 * *manage* qualifications meant only an administrator could read one. The page
 * then hides what each of them may not do, which is a separate question from
 * whether they may look.
 *
 * Deliberately not "any signed-in person". The list is written out at each
 * call so that widening it is a decision somebody makes and can be seen in a
 * diff, rather than a default that drifts.
 */
export async function requireAnyPermission(
  permissions: Permission[],
): Promise<AuthenticatedSession> {
  const session = await requireSession();
  if (!permissions.some((one) => session.permissions.includes(one))) {
    redirect("/not-permitted");
  }
  return session;
}
