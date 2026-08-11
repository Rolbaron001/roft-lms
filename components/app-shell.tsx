import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
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
  {
    href: "/qualifications",
    label: "Qualifications",
    permission: "qualification:manage",
  },
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
];

export function AppShell({
  tenant,
  session,
  children,
}: {
  tenant: TenantIdentity;
  session: AuthenticatedSession;
  children: React.ReactNode;
}) {
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
          <div>
            <p className="text-base font-semibold">{tenant.displayName}</p>
            <p className="text-xs opacity-75">Learning Management System</p>
          </div>
          <div className="flex items-center gap-4">
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

export function Card({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      {title ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
      ) : null}
      <div className={title || description ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "published"
      ? "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30"
      : status === "archived"
        ? "bg-[var(--muted)]/10 text-[var(--muted)] border-[var(--muted)]/30"
        : "bg-[var(--brand-accent)]/10 text-[var(--brand-accent)] border-[var(--brand-accent)]/40";

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      style={{ background: "var(--brand-primary)" }}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  name,
  ...props
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <input
        name={name}
        {...props}
        className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
      />
    </label>
  );
}
