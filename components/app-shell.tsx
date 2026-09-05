import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { extensionState } from "@/lib/extensions";
import { AiSwitch } from "./ai-switch";
import { NavMenu } from "./nav-menu";
import { arrangeNavigation } from "@/lib/navigation";
import { TenantLogo } from "./tenant-logo";
import { unreadCount } from "@/lib/notifications";
import type { AuthenticatedSession } from "@/lib/session";
import type { TenantIdentity } from "@/lib/tenant";

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

  // The AI switch belongs in the header for the same reason. Somebody switches
  // it on for one job and off again afterwards, which only works if it is
  // reachable from wherever that job happens rather than from a settings page
  // two clicks away. Absent entirely for anybody who has not set one up, so
  // nobody is shown a control that would only tell them no.
  const extension = await extensionState(session);

  // Filtered by permission rather than by role, so a link never appears for a
  // page the person would be refused. A section left with nothing in it is
  // dropped by the menu rather than shown empty.
  const sections = arrangeNavigation(tenant.navigation ?? null).map((section) => ({
    label: section.label,
    items: section.items
      .filter((item) =>
        item.permission
          ? session.permissions.includes(item.permission)
          : (item.anyPermission ?? []).some((permission) =>
              session.permissions.includes(permission),
            ),
      )
      .map((item) => ({ href: item.href, label: item.label })),
  })).filter((section) => section.items.length > 0);

  return (
    <div
      className="min-h-screen"
      style={
        {
          "--brand-primary": tenant.primaryColour,
          "--brand-accent": tenant.accentColour,
        } as React.CSSProperties
      }
    >
      <header
        className="border-b-4 text-white"
        style={{
          background: "var(--brand-primary)",
          borderColor: "var(--brand-accent)",
        }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            {tenant.logoUrl ? (
              // Sits on the tenant's own header colour, so a logo with a
              // transparent background reads correctly.
              <TenantLogo
                logoUrl={tenant.logoUrl}
                displayName={tenant.displayName}
                height={36}
              />
            ) : null}
            <div>
              <p className="text-base font-semibold">{tenant.displayName}</p>
              <p className="text-xs opacity-75">Learning Management System</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/notifications"
              className="relative rounded-md border border-white/30 px-3 py-1.5 text-sm transition hover:bg-white/10"
              aria-label={
                unread > 0
                  ? `Notifications, ${unread} unread`
                  : "Notifications"
              }
            >
              Notifications
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
              <AiSwitch on={extension.on} variant="header" />
            ) : null}

            <Link
              href="/account/password"
              className="text-xs opacity-75 underline-offset-2 transition hover:underline hover:opacity-100"
              title="Change your password"
            >
              {session.firstName} {session.lastName}
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-white/30 px-3 py-1.5 text-sm transition hover:bg-white/10"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/*
          Grouped rather than listed. px-6 matches the header above and the
          main column below, so the first item lines up with the logo and the
          page content rather than sitting 8px to their left.
        */}
        <NavMenu groups={sections} />

      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

// Re-exported so server components can keep importing everything from one
// place. Client components must import from "@/components/ui" directly.
export { Card, StatusBadge, PrimaryButton, TextField } from "./ui";
