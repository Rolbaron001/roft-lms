import Link from "next/link";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { activeProgrammes } from "@/lib/tracker";
import { Card } from "@/components/ui";
import { vocabulary } from "@/lib/terms";
import { maybe } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";

/**
 * Every programme that is running, and the dates it turns on.
 *
 * This replaces a spreadsheet, so it answers the question that spreadsheet was
 * opened to answer: what is running, how far through is it, and is anything
 * about to close. Nothing here is typed in twice - the learner count, the
 * sessions held and the task percentage are all read from the records
 * themselves, so the page cannot be out of date with the platform it reports
 * on.
 */
export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const tenant = await requireTenant();
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const session = await requirePermission("enrolment:read_all");

  const includeFinished = all === "1";
  const programmes = await activeProgrammes(session, { includeFinished });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell tenant={tenant} session={session}>
      <h1 className="text-xl font-semibold">{t("tracker.title")}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {includeFinished ? t("tracker.all") : t("tracker.running")}{" "}
        <Link
          href={includeFinished ? "/tracker" : "/tracker?all=1"}
          className="underline"
        >
          {includeFinished ? t("tracker.showRunning") : t("tracker.showAll")}
        </Link>
      </p>

      <div className="mt-6">
        <Card title={words.many("programme")} description={t("tracker.note")}>
          {programmes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("tracker.none")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">{t("tracker.cohort")}</th>
                    <th className="pb-2">{t("tracker.qualification")}</th>
                    <th className="pb-2">{t("tracker.learners")}</th>
                    <th className="pb-2">{t("tracker.training")}</th>
                    <th className="pb-2">{t("tracker.sessions")}</th>
                    <th className="pb-2">{t("tracker.tasks")}</th>
                    <th className="pb-2">{t("tracker.eisaRegistration")}</th>
                    <th className="pb-2">{t("tracker.eisa")}</th>
                    <th className="pb-2">{t("tracker.visit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {programmes.map((row) => {
                    // A registration window that has closed is worth seeing
                    // before somebody plans around it: there are only three
                    // assessment dates a year.
                    const registrationPassed =
                      row.eisaRegistrationDate !== null &&
                      row.eisaRegistrationDate < today;

                    return (
                      <tr
                        key={row.cohortId}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="py-2 pr-3">
                          <Link
                            href={`/cohorts/${row.cohortId}`}
                            className="hover:underline"
                          >
                            {row.cohortName}
                          </Link>
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {maybe(t, `tracker.status.${row.status}`) ?? row.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-[var(--muted)]">
                          {row.qualificationTitle ?? row.courseTitle}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.learners}
                        </td>
                        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                          {row.startDate}
                          {row.endDate ? ` – ${row.endDate}` : ""}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.sessionsTotal === 0
                            ? "—"
                            : `${row.sessionsHeld}/${row.sessionsTotal}`}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.tasksPercent === null
                            ? "—"
                            : `${row.tasksPercent}%`}
                        </td>
                        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                          {row.eisaRegistrationDate ?? (
                            <span className="text-[var(--muted)]">
                              {row.eisaNote ?? "—"}
                            </span>
                          )}
                          {registrationPassed ? (
                            <span className="ml-2 text-xs text-[var(--muted)]">
                              {t("tracker.closed")}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                          {row.eisaDate ?? "—"}
                        </td>
                        <td className="py-2 text-[var(--muted)]">
                          {maybe(t, `tracker.visit.${row.monitoringVisitStatus}`) ??
                            row.monitoringVisitStatus}
                          {row.monitoringVisitDate
                            ? ` · ${row.monitoringVisitDate}`
                            : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
