import Link from "next/link";
import { dateInZone } from "@/lib/timezone";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  listNotifications,
  notificationDue,
  buildLeisa,
} from "@/lib/statutory-notification";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import {
  AcknowledgeForm,
  DraftForm,
  OwnInductionForm,
  SubmitForm,
} from "./notify-forms";

/**
 * Notifying the QCTO that learners have been enrolled.
 *
 * The clock runs from induction and missing it is not a paperwork slip: the
 * learners are not registered, so their results have nowhere to go when they
 * finish. This screen exists so that nobody has to remember which cohort was
 * inducted when, and so that a late joiner is not quietly folded into a
 * submission whose deadline is not theirs.
 */
export default async function NotifyPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("report:statutory");

  const today = dateInZone(new Date(), tenant.timezone);
  const [due, notifications] = await Promise.all([
    notificationDue(session, today),
    listNotifications(session),
  ]);

  const overdue = due.filter((d) => d.state === "overdue");
  const soon = due.filter((d) => d.state === "due_soon");
  const noInduction = due.filter((d) => d.state === "no_induction");
  const notified = due.filter((d) => d.state === "notified");

  // Only worth the query for a draft the coordinator is about to act on.
  const drafts = notifications.filter((n) => n.status === "draft");
  const gaps = await Promise.all(
    drafts.map(async (draft) => ({
      id: draft.id,
      problems: (await buildLeisa(session, draft.id)).problems,
    })),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Enrolment notification</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          The QCTO has to be told that these learners were enrolled, within
          twenty-one working days of induction for a qualification and five for
          a skills programme. Public holidays do not count, and the clock runs
          from the induction date rather than from enrolment or payment.
        </p>
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${overdue.length} past the deadline`}
            description="Still submit these. A late notification with an explanation is a different problem to one nobody made."
          >
            <ul className="space-y-1">
              {overdue.map((row) => (
                <li key={row.userId} className="text-sm">
                  <span className="font-medium">
                    {row.firstName} {row.lastName}
                  </span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {row.cohortName} · was due {row.dueOn}
                    {row.workingDaysLeft !== null
                      ? ` · ${Math.abs(row.workingDaysLeft)} working days ago`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {soon.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${soon.length} due within a week`}
            description="Five working days or fewer remaining."
          >
            <ul className="space-y-1">
              {soon.map((row) => (
                <li key={row.userId} className="text-sm">
                  <span className="font-medium">
                    {row.firstName} {row.lastName}
                  </span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {row.cohortName} · due {row.dueOn} ·{" "}
                    {row.workingDaysLeft} working days left
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {noInduction.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${noInduction.length} have no induction date`}
            description="Their clock has not started, so there is no deadline to report. Date the cohort's induction session, or give them their own below."
          >
            <ul className="space-y-1">
              {noInduction.map((row) => (
                <li key={row.userId} className="text-sm">
                  {row.firstName} {row.lastName}
                  <span className="text-[var(--muted)]"> · {row.cohortName}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div className="mb-6">
        <Card
          title="Draft a submission"
          description="Everybody inducted on the same day goes together. A late joiner needs their own."
        >
          <DraftForm rows={due} />
        </Card>
      </div>

      <div className="mb-6">
        <Card
          title="A late joiner's own induction"
          description="Somebody who joined after the cohort started has their own induction, their own enrolment form and their own submission."
        >
          <OwnInductionForm rows={due} />
        </Card>
      </div>

      <div className="mb-6">
        <Card
          title="Submissions"
          description={`${notified.length} learners have been notified about.`}
        >
          {notifications.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Nothing drafted yet.
            </p>
          ) : (
            <ul className="space-y-4">
              {notifications.map((row) => {
                const problems =
                  gaps.find((g) => g.id === row.id)?.problems ?? [];

                return (
                  <li
                    key={row.id}
                    className="rounded-md border border-[var(--border)] p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        {row.title}
                        <span className="ml-2 font-normal text-[var(--muted)]">
                          {row.cohortName ?? "Individual"} · {row.learners}{" "}
                          {row.learners === 1 ? "learner" : "learners"} · due{" "}
                          {row.dueOn}
                        </span>
                      </p>
                      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                        {row.status}
                      </span>
                    </div>

                    {problems.length > 0 ? (
                      <div className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2">
                        <p className="text-sm font-medium text-[var(--danger)]">
                          {problems.length} would be rejected
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {problems.slice(0, 8).map((problem, index) => (
                            <li
                              key={`${problem.learner}-${problem.field}-${index}`}
                              className="text-xs text-[var(--danger)]"
                            >
                              {problem.learner}: {problem.field} — {problem.why}
                            </li>
                          ))}
                        </ul>
                        {problems.length > 8 ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            and {problems.length - 8} more.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Link
                        href={`/statutory/leisa/${row.id}`}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                      >
                        Download the workbook
                      </Link>

                      {row.status === "draft" ? (
                        <SubmitForm notificationId={row.id} />
                      ) : null}

                      {row.status === "submitted" ? (
                        <AcknowledgeForm notificationId={row.id} />
                      ) : null}

                      {row.acknowledgementReference ? (
                        <span className="text-sm text-[var(--muted)]">
                          Acknowledged · {row.acknowledgementReference}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
