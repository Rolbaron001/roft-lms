import Link from "next/link";
import { pageDates, pageT, requirePermission, requireTenant } from "@/lib/request";
import { AppShell, Card } from "@/components/app-shell";
import { credentialsRegister } from "@/lib/quality";
import { dateInZone } from "@/lib/timezone";

/**
 * Staff credentials (Heidi, 13 November 2026; job sheet D51): every
 * facilitator, assessor and moderator named on a programme, with their
 * registration number and its expiry, and what needs attention first.
 */
export default async function CredentialsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("audit:read");
  const t = await pageT();
  const dates = await pageDates();
  const rows = await credentialsRegister(session, dateInZone(new Date(), tenant.timezone));
  const order = { expired: 0, missing: 1, expiring: 2, valid: 3, not_needed: 4 } as const;
  const sorted = [...rows].sort((a, b) => order[a.state] - order[b.state]);
  const tone = { expired: "var(--danger)", missing: "var(--danger)", expiring: "var(--warning)", valid: "var(--success)", not_needed: "var(--muted)" } as const;
  const attention = rows.filter((row) => row.state === "expired" || row.state === "missing" || row.state === "expiring").length;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("credentials.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("credentials.intro")}</p>
        <p className="mt-2 text-sm">{attention ? t("credentials.attention", { count: attention }) : t("credentials.allGood")}</p>
      </div>
      <Card>
        {sorted.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("credentials.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-lg text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">{t("credentials.person")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("credentials.capacity")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("credentials.programme")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("credentials.number")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("credentials.expires")}</th>
                  <th className="pb-2 font-medium">{t("credentials.state")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, index) => (
                  <tr key={index} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/people/${row.userId}`} className="hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-xs">{t(`credentials.capacity.${row.capacity as "facilitator" | "assessor" | "moderator"}`)}</td>
                    <td className="py-2 pr-4 text-xs">{row.programme}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{row.registrationNumber ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs">{row.expiresOn ? dates.day(row.expiresOn) : "—"}</td>
                    <td className="py-2 text-xs font-medium" style={{ color: tone[row.state] }}>
                      {t(`credentials.state.${row.state}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-[var(--muted)]">{t("credentials.where")}</p>
    </AppShell>
  );
}
