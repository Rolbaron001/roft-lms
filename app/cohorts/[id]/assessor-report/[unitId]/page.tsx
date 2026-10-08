import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { AssessorReportError, assessorReport } from "@/lib/assessor-report";
import { AppShell } from "@/components/app-shell";
import { PrintButton } from "@/components/print-button";
import { maybe } from "@/lib/i18n/maybe";

/**
 * The assessor report for one study unit (job sheet D20), from the record,
 * laid out as Curiosa's own report is, and printed or saved as PDF for the
 * cohort's file.
 */
export default async function AssessorReportPage({ params }: { params: Promise<{ id: string; unitId: string }> }) {
  const { id, unitId } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const { t, day } = await pageLocale();

  let report;
  try {
    report = await assessorReport(session, id, unitId);
  } catch (error) {
    if (error instanceof AssessorReportError) notFound();
    throw error;
  }

  const result = (value: string | null) => (value ? (maybe(t, `outcome.${value}`) ?? maybe(t, `cohort.grid.${value}`) ?? value) : "—");
  const cell = "border border-[var(--border)] px-2 py-1.5 text-left align-top";
  const nobody =
    report.learners.length === 0 ? (
      <tr><td colSpan={5} className={`${cell} text-[var(--muted)]`}>{t("assessorReport.nobody")}</td></tr>
    ) : null;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/cohorts/${id}/file#assessorReports`} className="text-sm text-[var(--muted)] hover:underline">
          ← {t("cohortFile.folder.assessorReports")}
        </Link>
        <PrintButton />
      </div>

      <article className="space-y-6 text-sm">
        <h1 className="text-xl font-semibold">{t("assessorReport.title", { unit: report.unit.code })}</h1>

        <table className="w-full border-collapse">
          <tbody>
            <tr><th className={cell}>{t("assessorReport.programme")}</th><td className={cell}>{report.programme}</td></tr>
            <tr>
              <th className={cell}>{t("assessorReport.ids")}</th>
              <td className={cell}>
                {[report.saqaId ? `SAQA ${report.saqaId}` : null, report.nqfLevel ? t("assessorReport.level", { level: report.nqfLevel }) : null, report.credits ? t("assessorReport.credits", { credits: report.credits }) : null].filter(Boolean).join(" · ") || "—"}
              </td>
            </tr>
            <tr><th className={cell}>{t("assessorReport.unitCohort")}</th><td className={cell}>{report.unit.code} {report.unit.title} · {report.cohort}</td></tr>
            <tr><th className={cell}>{t("assessorReport.modules")}</th><td className={cell}>{report.modules.join(", ") || "—"}</td></tr>
            <tr><th className={cell}>{t("assessorReport.type")}</th><td className={cell}>{report.assessment?.title ?? "—"}</td></tr>
            <tr><th className={cell}>{t("assessorReport.date")}</th><td className={cell}>{report.assessment?.date ? day(report.assessment.date) : "—"}</td></tr>
            <tr>
              <th className={cell}>{t("assessorReport.assessor")}</th>
              <td className={cell}>{report.assessors.map((one) => `${one.name} (${one.email})`).join("; ") || "—"}</td>
            </tr>
          </tbody>
        </table>

        <section>
          <h2 className="mb-2 font-semibold">{t("assessorReport.results")}</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={cell}>#</th>
                <th className={cell}>{t("assessorReport.learner")}</th>
                <th className={cell}>{t("assessorReport.formative")}</th>
                <th className={cell}>{t("assessorReport.first")}</th>
                <th className={cell}>{t("assessorReport.second")}</th>
              </tr>
            </thead>
            <tbody>
              {nobody}
              {report.learners.map((learner, index) => (
                <tr key={learner.userId}>
                  <td className={cell}>{index + 1}</td>
                  <td className={cell}>{learner.name}</td>
                  <td className={cell}>{t("assessorReport.returned", { returned: learner.formative.returned, total: learner.formative.total })}</td>
                  <td className={cell}>{result(learner.first)}</td>
                  <td className={cell}>{result(learner.second)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">{t("assessorReport.attendance")}</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={cell}>#</th>
                <th className={cell}>{t("assessorReport.idNumber")}</th>
                <th className={cell}>{t("assessorReport.learner")}</th>
                <th className={cell}>{t("assessorReport.overall")}</th>
                <th className={cell}>{t("assessorReport.toDate")}</th>
              </tr>
            </thead>
            <tbody>
              {nobody}
              {report.learners.map((learner, index) => (
                <tr key={learner.userId}>
                  <td className={cell}>{index + 1}</td>
                  <td className={cell}>{learner.nationalId ?? "—"}</td>
                  <td className={cell}>{learner.name}</td>
                  <td className={cell}>{learner.overallPercent === null ? "—" : `${learner.overallPercent}%`}</td>
                  <td className={cell}>{learner.toDatePercent === null ? "—" : `${learner.toDatePercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">{t("assessorReport.comments")}</h2>
          {report.learners.every((learner) => learner.comments.length === 0) ? (
            <p className="text-[var(--muted)]">{t("assessorReport.noComments")}</p>
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {report.learners
                  .filter((learner) => learner.comments.length > 0)
                  .map((learner) => (
                    <tr key={learner.userId}>
                      <th className={cell}>{learner.name}</th>
                      <td className={cell}>{learner.comments.join(" ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="text-xs text-[var(--muted)]">{t("assessorReport.fromRecord")}</p>
      </article>
    </AppShell>
  );
}
