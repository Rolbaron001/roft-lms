import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { extensionState } from "@/lib/extensions";
import { AiSwitch } from "./ai-switch";
import { NavMenu } from "./nav-menu";
import { AccountMenu, FindPage, MobileMenu } from "./shell-nav";
import { arrangeNavigation } from "@/lib/navigation";
import { can } from "@/lib/features";
import { isViewOnly } from "@/lib/rbac";
import { vocabulary } from "@/lib/terms";
import { OfflineRegistration } from "./offline-registration";
import { TenantLogo } from "./tenant-logo";
import { TenantIllustrationProvider } from "./tenant-illustration";
import { platformIllustration } from "@/lib/platform";
import { unreadCount } from "@/lib/notifications";
import type { AuthenticatedSession } from "@/lib/session";
import type { TenantIdentity } from "@/lib/tenant";
import { DeploymentBanner } from "./deployment-banner";
import { I18nProvider } from "./i18n";
import { SuggestionTab } from "./suggestion-tab";
import { catalogueFor, maybe, translator } from "@/lib/i18n";
import { localeFor, pageDates } from "@/lib/request";
import { dateLocale } from "@/lib/i18n/locales";

/**
 * The shared frame. Navigation is filtered by permission rather than by role,
 * so a link never appears for a page the person would be refused.
 */
export async function AppShell({
  tenant,
  session,
  children,
}: {
  tenant: TenantIdentity;
  session: AuthenticatedSession;
  children: React.ReactNode;
}) {
  // Read here rather than on each page, so every screen shows the same count
  // and no page can forget to.
  const unread = await unreadCount(session);
  const viewOnly = !session.viewAs && isViewOnly(session);

  // The AI switch belongs in the header for the same reason. Somebody switches
  // it on for one job and off again afterwards, which only works if it is
  // reachable from wherever that job happens rather than from a settings page
  // two clicks away. Absent entirely for anybody who has not set one up, so
  // nobody is shown a control that would only tell them no.
  const extension = await extensionState(session);

  // Filtered by permission rather than by role, so a link never appears for a
  // page the person would be refused. A section left with nothing in it is
  // dropped by the menu rather than shown empty.
  // With the structure, so a provider who chose study units reads "Study
  // units" where the menu would otherwise say "Courses".
  // In the person's own language (job sheet D9). A heading or item the
  // provider named themselves has no catalogue entry and keeps their words.
  const locale = localeFor(tenant, session);
  const t = translator(locale);
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const sections = arrangeNavigation(tenant.navigation ?? null, words)
    .map((section) => ({
      label: section.label === null ? null : (maybe(t, `nav.heading.${section.label}`) ?? section.label),
      items: section.items
        // A capability the tenant has not switched on has no link, whoever is
        // looking. Checked before the permission, because "this does not exist
        // here" comes before "you may not".
        .filter((item) =>
          item.feature === undefined
            ? true
            : item.feature === "offline"
              ? tenant.offlineEnabled
              : can(tenant.featureFlags, item.feature),
        )
        .filter((item) =>
          item.permission
            ? session.permissions.includes(item.permission)
            : (item.anyPermission ?? []).some((permission) =>
                session.permissions.includes(permission),
              ),
        )
        .filter((item) => !item.notWith || !session.permissions.includes(item.notWith))
        .map((item) => ({
          href: item.href,
          // An item named after a provider term already reads in the
          // provider's word, translated where they kept the default.
          label: item.term ? item.label : (maybe(t, `nav.${item.href}`) ?? item.label),
        })),
    }))
    .filter((section) => section.items.length > 0);

  // The person's name, their account and signing out: under the initials on a
  // laptop, at the foot of the Menu panel on a phone.
  const account = (
    <div className="space-y-2">
      <p className="font-medium">
        {session.firstName} {session.lastName}
      </p>
      <Link href="/account/password" className="block underline-offset-2 hover:underline">
        {t("shell.account")}
      </Link>
      {extension.available ? (
        <div className="sm:hidden">
          <AiSwitch on={extension.on} />
        </div>
      ) : null}
      {session.viewAs ? null : (
        <form action={logoutAction}>
          <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm">
            {t("shell.signOut")}
          </button>
        </form>
      )}
    </div>
  );

  return (
    <div
      className="min-h-screen"
      style={
        {
          "--brand-primary": tenant.primaryColour,
          "--brand-accent": tenant.accentColour,
          // A provider's own page tint (D42), behind the white cards.
          ...(tenant.backgroundColour ? { "--background": tenant.backgroundColour, background: tenant.backgroundColour } : {}),
        } as React.CSSProperties
      }
    >
      {/*
        Only for a tenant that asked for offline. Not rendered at all otherwise,
        so an ordinary tenant's learner has no path to registering anything -
        and the server refuses to serve /sw.js to them as well.
      */}
      {tenant.offlineEnabled ? <OfflineRegistration /> : null}

      <DeploymentBanner />

      <header
        className="border-b-4 text-white"
        style={{
          background: "var(--brand-primary)",
          borderColor: "var(--brand-accent)",
        }}
      >
        {/*
          One row on a laptop: the provider, the menu, then compact controls.
          It was two rows, provider above menu, which with a page's own
          navigation left a 13-inch screen little room for the page (Cecelia
          and Heidi, 19 October 2026). Below 1024 pixels the menu folds into
          one Menu button (components/shell-nav.tsx). Wider than the page
          column, so the row fits at 1280 pixels.
        */}
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 sm:px-6">
          <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3">
            {tenant.logoUrl ? (
              // Sits on the tenant's own header colour, so a logo with a
              // transparent background reads correctly.
              <TenantLogo
                logoUrl={tenant.logoUrl}
                displayName={tenant.displayName}
                height={32}
              />
            ) : null}
            <div className="min-w-0">
              <p className="max-w-[14rem] truncate text-sm font-semibold sm:text-base">{tenant.displayName}</p>
              <p className="hidden text-xs opacity-75 2xl:block">{t("shell.subtitle")}</p>
            </div>
          </Link>

          <NavMenu groups={sections} className="hidden min-w-0 flex-1 lg:flex" />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {session.viewAs ? (
              // Signing out is a change, refused while viewing: Stop first.
              <form action="/api/view-as/stop" method="post">
                <button type="submit" className="rounded-md bg-white px-3 py-1.5 text-sm font-medium" style={{ color: "var(--brand-primary)" }}>
                  {t("viewAs.stop")}
                </button>
              </form>
            ) : null}

            <FindPage groups={sections} />

            <Link
              href="/notifications"
              className="relative inline-flex items-center rounded-md border border-white/30 px-2.5 py-1.5 text-sm transition hover:bg-white/10"
              title={t("shell.notifications")}
              aria-label={
                unread > 0
                  ? t("shell.notificationsUnread", { count: unread })
                  : t("shell.notifications")
              }
            >
              <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 4-1.5 5.5-1.5 5.5h12s-1.5-1.5-1.5-5.5A4.5 4.5 0 0 0 10 3Z" />
                <path d="M8.5 15.5a1.6 1.6 0 0 0 3 0" strokeLinecap="round" />
              </svg>
              <span className="ml-2 hidden xl:inline">{t("shell.notifications")}</span>
              {unread > 0 ? (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold"
                  style={{
                    background: "var(--brand-accent)",
                    color: "var(--brand-primary)",
                  }}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Link>

            {extension.available ? (
              <div className="hidden sm:block">
                <AiSwitch on={extension.on} variant="header" />
              </div>
            ) : null}

            <div className="hidden lg:block">
              <AccountMenu name={`${session.firstName} ${session.lastName}`}>{account}</AccountMenu>
            </div>
            <div className="lg:hidden">
              <MobileMenu groups={sections} account={account} />
            </div>
          </div>
        </div>

        {/* "View as" (lib/view-as.ts): whose view this is, on every page. */}
        {session.viewAs ? (
          <div className="bg-white/95 px-6 py-2 text-center text-sm" style={{ color: "var(--brand-primary)" }}>
            {t("viewAs.banner", {
              person: `${session.firstName} ${session.lastName}`,
              roles: session.roles.map((role) => maybe(t, `role.${role}`) ?? role).join(", "),
              by: session.viewAs.byName,
            })}
          </div>
        ) : null}

        {/* "Administrator View" (lib/rbac.ts): said on every page, since the
            database refuses every change the person tries. */}
        {viewOnly ? (
          <div className="bg-white/95 px-6 py-2 text-center text-sm" style={{ color: "var(--brand-primary)" }}>
            {t("viewOnly.banner")}
          </div>
        ) : null}

      </header>

      {/*
        Said once here rather than passed to each control that wants it. The
        tenant's own picture, or this deployment's, or none - the same order
        the empty states use, and for the same reason: one operator having a
        mascot must not put that mascot in another operator's product.
      */}
      <TenantIllustrationProvider
        url={tenant.illustrationUrl ?? platformIllustration()}
      >
        <I18nProvider messages={catalogueFor(locale)} dates={dateLocale(locale)} dateSettings={(await pageDates()).settings}>
          <main className="mx-auto max-w-5xl px-6 py-8" data-view-only={viewOnly ? "" : undefined}>{children}</main>
          <SuggestionTab />
        </I18nProvider>
      </TenantIllustrationProvider>
    </div>
  );
}

// Re-exported so server components can keep importing everything from one
// place. Client components must import from "@/components/ui" directly.
export { Card, StatusBadge, PrimaryButton, TextField } from "./ui";
