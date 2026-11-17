import Link from "next/link";
import { pageDates, pageT, requirePermission, requireTenant } from "@/lib/request";
import { AppShell, Card } from "@/components/app-shell";
import { auditActors, auditTrail } from "@/lib/quality";

/**
 * The audit trail (Heidi, 13 November 2026; job sheet D51): every change made
 * on the platform, who made it and when, filtered and downloadable. Read by
 * the Quality Assurer, the administrator, moderators and external verifiers.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string; from?: string; to?: string }> }) {
  const tenant = await requireTenant();
  const session = await requirePermission("audit:read");
  const t = await pageT();
  const dates = await pageDates();
  const filter = await searchParams;
  const [rows, actors] = await Promise.all([
    auditTrail(session, { action: filter.action, actorId: filter.actor, from: filter.from, to: filter.to }),
    auditActors(session),
  ]);
  const query = new URLSearchParams(Object.entries(filter).filter(([, value]) => value) as [string, string][]).toString();
  const input = "rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-sm";

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("audit.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("audit.intro")}</p>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          <span className="block text-xs font-medium">{t("audit.action")}</span>
          <input name="action" defaultValue={filter.action ?? ""} placeholder={t("audit.actionHint")} className={input} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium">{t("audit.who")}</span>
          <select name="actor" defaultValue={filter.actor ?? ""} className={input}>
            <option value="">{t("audit.anyone")}</option>
            {actors.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium">{t("audit.from")}</span>
          <input name="from" type="date" defaultValue={filter.from ?? ""} className={input} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium">{t("audit.to")}</span>
          <input name="to" type="date" defaultValue={filter.to ?? ""} className={input} />
        </label>
        <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-1.5 font-medium">
          {t("audit.filter")}
        </button>
        <a href={`/audit/export${query ? `?${query}` : ""}`} className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 font-medium text-white">
          {t("audit.download")}
        </a>
        {query ? (
          <Link href="/audit" className="text-[var(--muted)] hover:underline">
            {t("audit.clear")}
          </Link>
        ) : null}
      </form>

      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("audit.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-lg text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">{t("audit.when")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("audit.who")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("audit.action")}</th>
                  <th className="pb-2 font-medium">{t("audit.on")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b border-[var(--border)] align-top last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap text-xs">{dates.when(row.occurredAt)}</td>
                    <td className="py-2 pr-4 text-xs">{row.actor ?? t("audit.platform")}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{row.action}</td>
                    <td className="py-2 text-xs text-[var(--muted)]">{row.entityType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">{t("audit.limit")}</p>
      </Card>
    </AppShell>
  );
}
