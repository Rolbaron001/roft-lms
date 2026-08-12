import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { TenantLogo } from "./tenant-logo";
import { unreadCount } from "@/lib/notifications";
import type { AuthenticatedSession } from "@/lib/session";
import type { TenantIdentity } from "@/lib/tenant";
import type { Permission } from "@/lib/rbac";

/**
 * The shared frame. Navigation is filtered by permission rather than by role,
 * so a link never appears for a page the person would be refused.
 */
type NavItem = {
  href: string;
  label: string;
  permission?: Permission;
  /** Shown when the person holds any one of these. */
  anyPermission?: Permission[];
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", permission: "report:own" },
  { href: "/courses", label: "Courses", permission: "course:read" },
  { href: "/paths", label: "Programmes", permission: "course:author" },
  {
    href: "/qualifications",
    label: "Qualifications",
    permission: "qualification:manage",
  },
  { href: "/people", label: "People", permission: "user:invite" },
  { href: "/assess", label: "To assess", permission: "assessment:assess" },
  { href: "/moderate", label: "To moderate", permission: "assessment:moderate" },
  // Every signed-in person holds report:own, but a learner has no dashboard
  // worth a menu entry, so this is gated on team-or-wider reporting. Someone
  // holding two roles can satisfy both, hence the deduplication below.
  {
    href: "/reports",
    label: "Reports",
    anyPermission: ["report:team", "report:tenant"],
  },
  { href: "/statutory", label: "Statutory", permission: "report:statutory" },
  { href: "/settings", label: "Appearance", permission: "tenant:manage_branding" },
  // ROFT's own console, for managing every other client.
  { href: "/platform", label: "Clients", permission: "platform:manage_tenants" },
];

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

  const links = NAV.filter((item) => {
    if (item.permission) return session.permissions.includes(item.permission);
    return (item.anyPermission ?? []).some((permission) =>
      session.permissions.includes(permission),
    );
  });

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

            <span className="text-xs opacity-75">
              {session.firstName} {session.lastName}
            </span>
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

        <nav className="mx-auto flex max-w-5xl gap-1 px-4">
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-t-md px-4 py-2 text-sm transition hover:bg-white/10"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

// Re-exported so server components can keep importing everything from one
// place. Client components must import from "@/components/ui" directly.
export { Card, StatusBadge, PrimaryButton, TextField } from "./ui";
