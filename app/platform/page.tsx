import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { listTenants, platformHealth } from "@/lib/provisioning";
import { maybe } from "@/lib/i18n";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { NewTenantForm } from "./new-tenant-form";

export default async function PlatformPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("platform:manage_tenants");
  const t = await pageT();

  const [tenants, health] = await Promise.all([
    listTenants(session),
    platformHealth(session),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("platformPage.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("platformPage.intro")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t("platformPage.organisations"), health.activeTenants],
          [t("platformPage.people"), health.people],
          [t("platformPage.assigned"), health.enrolments],
          [t("platformPage.certificates"), health.certificates],
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
          {health.tenantsWithoutAdministrator === 1
            ? t("platformPage.noAdminOne")
            : t("platformPage.noAdmin", { count: health.tenantsWithoutAdministrator })}
        </p>
      ) : null}

      <div className="mt-6">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-lg text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">{t("platformPage.organisation")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("platformPage.address")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("platformPage.mode")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("platformPage.usage")}</th>
                  <th className="pb-2 font-medium">{t("platformPage.status")}</th>
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
                      {maybe(t, `platformPage.mode.${row.deploymentMode}`) ?? row.deploymentMode}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-[var(--muted)]">
                      {t("platformPage.usageCounts", { people: row.people, certificates: row.certificates })}
                      {row.administrators === 0 ? (
                        <span className="block font-medium text-[var(--danger)]">
                          {t("platformPage.noAdministrator")}
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
        {/* This deployment's own address: lms.curiosa.academy on live,
            lms.roftbusiness.org on development. Never written in here. */}
        <NewTenantForm platformHost={process.env.PLATFORM_HOST ?? "localhost:3000"} />
      </div>
    </AppShell>
  );
}
