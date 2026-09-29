import Link from "next/link";
import { dateInZone } from "@/lib/timezone";
import { pageT, requireCapability, requirePermission, said } from "@/lib/request";
import { maybe } from "@/lib/i18n";
import {
  listNotifications,
  notificationDue,
  buildLeisa,
} from "@/lib/statutory-notification";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { recipientsFor } from "@/lib/qcto-recipients";
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
  const tenant = await requireCapability("statutory_reporting");
  const session = await requirePermission("report:statutory");
  const t = await pageT();

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
      problems: (await said(await buildLeisa(session, draft.id))).problems,
    })),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("enrolNotify.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("enrolNotify.intro")}</p>
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6">
          <Card title={t("enrolNotify.overdue", { count: overdue.length })} description={t("enrolNotify.overdueNote")}>
            <ul className="space-y-1">
              {overdue.map((row) => (
                <li key={row.userId} className="text-sm">
                  <span className="font-medium">
                    {row.firstName} {row.lastName}
                  </span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {row.cohortName} · {t("enrolNotify.wasDue", { date: row.dueOn ?? "" })}
                    {row.workingDaysLeft !== null
                      ? ` · ${t("enrolNotify.daysAgo", { count: Math.abs(row.workingDaysLeft) })}`
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
          <Card title={t("enrolNotify.soon", { count: soon.length })} description={t("enrolNotify.soonNote")}>
            <ul className="space-y-1">
              {soon.map((row) => (
                <li key={row.userId} className="text-sm">
                  <span className="font-medium">
                    {row.firstName} {row.lastName}
                  </span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {row.cohortName} · {t("enrolNotify.due", { date: row.dueOn ?? "" })} ·{" "}
                    {t("enrolNotify.daysLeft", { count: row.workingDaysLeft ?? 0 })}
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
            title={t("enrolNotify.noInduction", { count: noInduction.length })}
            description={t("enrolNotify.noInductionNote")}
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
        <Card title={t("enrolNotify.draft")} description={t("enrolNotify.draftNote")}>
          <DraftForm rows={due} />
        </Card>
      </div>

      <div className="mb-6">
        <Card title={t("enrolNotify.ownInduction")} description={t("enrolNotify.ownInductionNote")}>
          <OwnInductionForm rows={due} />
        </Card>
      </div>

      <div className="mb-6">
        <Card title={t("enrolNotify.submissions")} description={t("enrolNotify.notified", { count: notified.length })}>
          {notifications.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("enrolNotify.nothingDrafted")}</p>
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
                          {row.cohortName ?? t("enrolNotify.individual")} ·{" "}
                          {row.learners === 1 ? t("enrolNotify.learnerOne") : t("enrolNotify.learners", { count: row.learners })}{" "}
                          · {t("enrolNotify.due", { date: row.dueOn ?? "" })}
                        </span>
                      </p>
                      <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                        {maybe(t, `enrolNotify.status.${row.status}`) ?? row.status}
                      </span>
                    </div>

                    {problems.length > 0 ? (
                      <div className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2">
                        <p className="text-sm font-medium text-[var(--danger)]">
                          {t("enrolNotify.rejected", { count: problems.length })}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {problems.slice(0, 8).map((problem, index) => (
                            <li
                              key={`${problem.learner}-${problem.field}-${index}`}
                              className="text-xs text-[var(--danger)]"
                            >
                              {problem.learner}: {problem.field}: {problem.why}
                            </li>
                          ))}
                        </ul>
                        {problems.length > 8 ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {t("statutory.more", { count: problems.length - 8 })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {/*
                      Where it actually goes. The procedure uses two different
                      addresses depending on what the learners are enrolled on,
                      and a workbook that is right in every cell but sent to the
                      wrong address has not been submitted.
                    */}
                    <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2,transparent)] px-3 py-2">
                      {recipientsFor(row.kinds).map((recipient) => (
                        <p key={recipient.address} className="text-sm">
                          <span className="text-[var(--muted)]">{t("enrolNotify.sendTo")} </span>
                          <span className="font-mono">{recipient.address}</span>
                          {recipient.enclose ? (
                            <span className="block text-xs text-[var(--muted)]">
                              {recipient.enclose}
                            </span>
                          ) : null}
                        </p>
                      ))}
                      {recipientsFor(row.kinds).length > 1 ? (
                        <p
                          className="mt-1 text-xs"
                          style={{ color: "var(--danger)" }}
                        >
                          {t("enrolNotify.split")}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("enrolNotify.askAck")}</p>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Link
                        href={`/statutory/leisa/${row.id}`}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                      >
                        {t("enrolNotify.download")}
                      </Link>

                      {row.status === "draft" ? (
                        <SubmitForm notificationId={row.id} />
                      ) : null}

                      {row.status === "submitted" ? (
                        <AcknowledgeForm notificationId={row.id} />
                      ) : null}

                      {row.acknowledgementReference ? (
                        <span className="text-sm text-[var(--muted)]">
                          {t("enrolNotify.acknowledged", { reference: row.acknowledgementReference })}
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
