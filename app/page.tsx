import { requireSession, requireTenant } from "@/lib/request";
import { logoutAction } from "./login/actions";

const ROLE_LABELS: Record<string, string> = {
  platform_owner: "Platform Owner",
  tenant_admin: "Administrator",
  instructor: "Instructor",
  assessor: "Assessor",
  moderator: "Moderator",
  line_manager: "Line Manager",
  learner: "Learner",
  skills_development_facilitator: "Skills Development Facilitator",
  external_verifier: "External Verifier",
};

/**
 * Placeholder home page.
 *
 * Role-specific dashboards arrive with the course and reporting slices. For
 * now this proves the parts built so far work end to end: the tenant was
 * resolved from the hostname, the session was verified against the database,
 * and the roles and permissions shown are the ones this person actually holds.
 */
export default async function HomePage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  const grouped = new Map<string, string[]>();
  for (const permission of [...session.permissions].sort()) {
    const [area, action] = permission.split(":");
    grouped.set(area, [...(grouped.get(area) ?? []), action]);
  }

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
        className="border-b-4 px-6 py-4 text-white"
        style={{
          background: "var(--brand-primary)",
          borderColor: "var(--brand-accent)",
        }}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold">{tenant.displayName}</p>
            <p className="text-xs opacity-75">Learning Management System</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-white/30 px-3 py-1.5 text-sm transition hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h1 className="text-lg font-semibold">
            {session.firstName} {session.lastName}
          </h1>
          <p className="text-sm text-[var(--muted)]">{session.email}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {session.roles.length === 0 ? (
              <span className="text-sm text-[var(--muted)]">
                No roles assigned yet.
              </span>
            ) : (
              session.roles.map((role) => (
                <span
                  key={role}
                  className="rounded-full px-3 py-1 text-xs font-medium text-white"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {ROLE_LABELS[role] ?? role}
                </span>
              ))
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            What this account may do
          </h2>
          <dl className="mt-4 space-y-3">
            {[...grouped.entries()].map(([area, actions]) => (
              <div key={area} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                <dt className="text-sm font-medium capitalize">
                  {area.replace(/_/g, " ")}
                </dt>
                <dd className="text-sm text-[var(--muted)]">
                  {actions.map((action) => action.replace(/_/g, " ")).join(", ")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
