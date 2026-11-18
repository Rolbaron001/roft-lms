import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requireAnyPermission, requireTenant } from "@/lib/request";
import { getReport } from "@/lib/moderation-report";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell, Card } from "@/components/app-shell";
import { ReportEditor } from "../report-forms";

/**
 * One Moderation Report: its figures, drafted by the platform; its findings
 * and recommendations, written by the moderator; and, once signed, its
 * signature and the decisions it locked (job sheet D52 (4) and (5)).
 */
export default async function ModerationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireAnyPermission(["assessment:moderate", "verification:external_audit", "records:read"]);
  const { t, day, when } = await pageLocale();
  const report = await getReport(session, id);
  if (!report) notFound();
  const f = report.figures;

  return (
    <AppShell tenant={tenant} session={session}>
      <p className="mb-4 text-sm">
        <Link href="/moderate/reports" className="text-[var(--muted)] hover:underline">
          ← {t("modReport.title")}
        </Link>
      </p>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{report.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {report.moderator}
          {report.signedAt ? ` · ${t("modReport.signedBy", { when: when(report.signedAt) })}` : ` · ${t("modReport.draftNote")}`}
        </p>
      </div>

      <div className="mb-6">
        <Card title={t("modReport.figures")} description={report.signedAt ? t("modReport.figuresSigned") : t("modReport.figuresDraft")}>
          <p className="text-sm">
            {t("modReport.figuresLine", { decisions: f.decisions, sampled: f.sampled, moderated: f.moderated, endorsed: f.endorsed, referred: f.referredBack, overridden: f.overridden })}
          </p>
          {f.byAssessor.length > 0 ? (
            <table className="mt-3 w-full max-w-3xl text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="py-1 pr-3">{t("sample.assessor")}</th>
                  <th className="py-1 pr-3">{t("modReport.colDecisions")}</th>
                  <th className="py-1 pr-3">{t("modReport.colModerated")}</th>
                  <th className="py-1 pr-3">{t("sample.moderated.endorsed")}</th>
                  <th className="py-1 pr-3">{t("sample.moderated.referred_back")}</th>
                  <th className="py-1">{t("sample.moderated.overridden")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {f.byAssessor.map((row) => (
                  <tr key={row.assessor}>
                    <td className="py-1 pr-3">{row.assessor}</td>
                    <td className="py-1 pr-3">{row.decisions}</td>
                    <td className="py-1 pr-3">{row.moderated}</td>
                    <td className="py-1 pr-3">{row.endorsed}</td>
                    <td className="py-1 pr-3">{row.referredBack}</td>
                    <td className="py-1">{row.overridden}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      </div>

      {report.signedAt ? (
        <div className="space-y-6">
          <Card title={t("modReport.findings")}>
            <p className="max-w-3xl whitespace-pre-line text-sm">{report.findings}</p>
          </Card>
          {report.recommendations ? (
            <Card title={t("modReport.recommendations")}>
              <p className="max-w-3xl whitespace-pre-line text-sm">{report.recommendations}</p>
            </Card>
          ) : null}
          <Card title={t("modReport.signature")}>
            <p className="text-sm">
              {t("modReport.signatureLine", { name: report.moderator, when: when(report.signedAt), registration: report.registrationNumber ?? t("modReport.noRegistration") })}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">{report.signatureHash}</p>
          </Card>
          {report.lockedDecisions.length > 0 ? (
            <Card title={t("modReport.locked")} description={t("modReport.lockedIntro")}>
              <ul className="divide-y divide-[var(--border)] text-sm">
                {report.lockedDecisions.map((row) => (
                  <li key={row.decisionId} className="flex flex-wrap justify-between gap-3 py-1.5">
                    <span>
                      {row.learner} · {row.assessment}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {row.assessor} · {maybe(t, `sample.moderated.${row.moderated}`) ?? row.moderated} · {row.decidedAt ? day(row.decidedAt) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : report.mine ? (
        <ReportEditor reportId={report.id} findings={report.findings} recommendations={report.recommendations} registrationNumber={report.registrationNumber ?? ""} />
      ) : (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t("modReport.notYours")}</p>
        </Card>
      )}
    </AppShell>
  );
}
