import Link from "next/link";
import { pageLocale, requireAnyPermission, requireTenant } from "@/lib/request";
import { listReports, reportScopes } from "@/lib/moderation-report";
import { AppShell, Card } from "@/components/app-shell";
import { NewReport } from "./report-forms";

/**
 * Moderation Reports: a moderator's own, and every signed one for an external
 * verifier or Quality Assurer (Heidi's role specifications, job sheet D52 (4)).
 */
export default async function ModerationReportsPage() {
  const tenant = await requireTenant();
  const session = await requireAnyPermission(["assessment:moderate", "verification:external_audit", "records:read"]);
  const { t, day } = await pageLocale();
  const moderates = session.permissions.includes("assessment:moderate");
  const [reports, scopes] = await Promise.all([listReports(session), moderates ? reportScopes(session) : []]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("modReport.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{moderates ? t("modReport.intro") : t("modReport.introVerifier")}</p>
      </div>

      {moderates ? (
        <div className="mb-6">
          <Card title={t("modReport.new")}>
            <NewReport scopes={scopes} />
          </Card>
        </div>
      ) : null}

      <Card>
        {reports.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("modReport.none")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                <Link href={`/moderate/reports/${report.id}`} className="font-medium hover:underline">
                  {report.title}
                </Link>
                <span className="text-xs text-[var(--muted)]">
                  {report.moderator} ·{" "}
                  {report.signedAt
                    ? t("modReport.signedOn", { date: day(report.signedAt), count: report.locked })
                    : t("modReport.draft", { date: day(report.updatedAt) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppShell>
  );
}
