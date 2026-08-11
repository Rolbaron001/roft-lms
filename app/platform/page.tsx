import { requirePermission, requireTenant } from "@/lib/request";
import { listTenants, platformHealth } from "@/lib/provisioning";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { NewTenantForm } from "./new-tenant-form";

const MODE_LABELS: Record<string, string> = {
  shared_cloud: "Shared cloud",
  dedicated_cloud: "Dedicated cloud",
  on_premise: "On premise",
};

export default async function PlatformPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("platform:manage_tenants");

  const [tenants, health] = await Promise.all([
    listTenants(session),
    platformHealth(session),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Client organisations</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Every organisation on the platform. You can see how much each is
          using and manage their configuration — but not their learners,
          courses or assessment records. Hosting a client&rsquo;s system is not
          the same as being entitled to read it, and the platform enforces that
          rather than relying on restraint.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Organisations", health.activeTenants],
          ["People", health.people],
          ["Courses assigned", health.enrolments],
          ["Certificates issued", health.certificates],
        ].map(([label, value]) => (
          <div
            key={label as string}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
          >
            <p className="text-2xl font-semibold">{value}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{label}</p>
          </div>
        ))}
      </div>

      {health.tenantsWithoutAdministrator > 0 ? (
        <p className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]">
          {health.tenantsWithoutAdministrator}{" "}
          {health.tenantsWithoutAdministrator === 1
            ? "organisation has"
            : "organisations have"}{" "}
          no administrator. Nobody there can manage their own system.
        </p>
      ) : null}

      <div className="mt-6">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-lg text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">Organisation</th>
                  <th className="pb-2 pr-4 font-medium">Address</th>
                  <th className="pb-2 pr-4 font-medium">Mode</th>
                  <th className="pb-2 pr-4 font-medium">Usage</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="py-2.5 pr-4">
                      <span className="font-medium">{row.displayName}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {row.legalName}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-[var(--muted)]">
                      {row.customDomain ?? `${row.slug}.…`}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      {MODE_LABELS[row.deploymentMode] ?? row.deploymentMode}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-[var(--muted)]">
                      {row.people} people · {row.certificates} certificates
                      {row.administrators === 0 ? (
                        <span className="block font-medium text-[var(--danger)]">
                          No administrator
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <NewTenantForm />
      </div>
    </AppShell>
  );
}
