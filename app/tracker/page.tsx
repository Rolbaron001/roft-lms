import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { activeProgrammes } from "@/lib/tracker";
import { Card } from "@/components/ui";

const VISIT_LABEL: Record<string, string> = {
  not_scheduled: "Not scheduled",
  scheduled: "Scheduled",
  conducted: "Conducted",
  findings_outstanding: "Findings outstanding",
  closed: "Closed",
};

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
  await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  const includeFinished = all === "1";
  const programmes = await activeProgrammes(session, { includeFinished });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-xl font-semibold">Tracker</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {includeFinished
          ? "Every cohort, including those finished and cancelled."
          : "Every cohort still running."}{" "}
        <Link
          href={includeFinished ? "/tracker" : "/tracker?all=1"}
          className="underline"
        >
          {includeFinished ? "Show only what is running" : "Show all of them"}
        </Link>
      </p>

      <div className="mt-6">
        <Card
          title="Programmes"
          description="Read from the records rather than kept by hand, so it cannot disagree with the platform it reports on."
        >
          {programmes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No cohorts yet. A cohort is what a schedule, a register and a
              statutory return all hang from.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">Cohort</th>
                    <th className="pb-2">Qualification</th>
                    <th className="pb-2">Learners</th>
                    <th className="pb-2">Training</th>
                    <th className="pb-2">Sessions</th>
                    <th className="pb-2">Tasks</th>
                    <th className="pb-2">EISA registration</th>
                    <th className="pb-2">EISA</th>
                    <th className="pb-2">Monitoring visit</th>
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
                            {row.status}
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
                              closed
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                          {row.eisaDate ?? "—"}
                        </td>
                        <td className="py-2 text-[var(--muted)]">
                          {VISIT_LABEL[row.monitoringVisitStatus] ??
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
    </main>
  );
}
