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
  { href: "/capture", label: "Capture", permission: "assessment:author" },
  { href: "/cohorts", label: "Cohorts", permission: "enrolment:read_all" },
  { href: "/tracker", label: "Tracker", permission: "enrolment:read_all" },
  // Everyone who has been given a platform mailbox. The page itself explains
  // it when somebody has not.
  { href: "/mail", label: "Mail", permission: "report:own" },
  {
    href: "/readiness",
    label: "EISA readiness",
    permission: "enrolment:read_all",
  },
  // Reached by learners, coaches and staff alike, so it is gated on any one
  // of the three permissions rather than a single role's.
  {
    href: "/workplace",
    label: "Work experience",
    anyPermission: ["workplace:sign", "workplace:manage", "workplace:log"],
  },
  { href: "/appeals", label: "Appeals", permission: "appeal:manage" },
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
  // Learners held after a second not-yet-competent result. Work waiting to be
  // done rather than a register to browse, so it sits with the other screens
  // somebody opens to find out what needs their attention today.
  {
    href: "/reassessments",
    label: "Held for review",
    permission: "enrolment:read_all",
  },
  // A reference, not a record. Every signed-in person can read it, learners
  // included — it exists so that everybody uses the same words.
  { href: "/dictionary", label: "Dictionary", permission: "report:own" },
  { href: "/settings", label: "Settings", permission: "tenant:manage_branding" },
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
          Wraps rather than overflowing. There are fifteen links and the list
          grows; at 1440px they already ran 361px past the container, which put
          the last two off the right edge of the window entirely — invisible and
          unclickable, with no scrollbar to hint they were there.

          px-6 matches the header above and the main column below, so the first
          link lines up with the logo and the page content rather than sitting
          8px to their left.
        */}
        <nav className="mx-auto flex max-w-5xl flex-wrap gap-1 px-6 pb-1">
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
