import Link from "next/link";
import type { AdminDashboard } from "@/lib/dashboard";
import type { Translate } from "@/lib/i18n";
import { maybe } from "@/lib/i18n/maybe";
import { Card } from "@/components/app-shell";

type Day = (date: string | Date, options?: { short?: boolean }) => string;

const WARNING = "text-amber-700 dark:text-amber-400";
const TONE = { danger: "text-[var(--danger)]", warning: WARNING, plain: "text-[var(--foreground)]" } as const;

const STEP_HREF = (id: string, step: string) =>
  ({ payment: `/cohorts/${id}#payment`, learners: `/cohorts/${id}#learners`, plan: `/cohorts/${id}/plan`, sessions: `/cohorts/${id}#sessions` })[step] ?? `/cohorts/${id}`;

/**
 * The administrator's dashboard (job sheet D25), as designed on the canvas and
 * approved by Roland on 8 October 2026: what needs acting on today across the
 * top, the cohorts running and being set up, the learners held up, then down
 * the side today's timetable, what falls due in the next fortnight, the
 * qualifications still being built, work waiting on other people and feedback
 * received. Every line is a link to where the work is done.
 */
export function AdminDashboardView({ data, t, day }: { data: AdminDashboard; t: Translate; day: Day }) {
  const sessionName = (row: { title: string | null; kind: string; sequence: number | null }) =>
    row.title || [maybe(t, `session.kind.${row.kind}`) ?? row.kind, row.sequence ? String(row.sequence) : null].filter(Boolean).join(" ");
  const urgentLabel = (key: AdminDashboard["urgent"][number]["key"], n: number) => (n === 1 ? t(`dash.urgent.${key}.one`) : t(`dash.urgent.${key}.many`));
  const today = new Date().toISOString().slice(0, 10);
  const urgentDetail = (row: AdminDashboard["urgent"][number]) =>
    row.key === "leisa" && row.on && row.on < today
      ? t("dash.urgent.leisa.overdue", { date: day(row.on) })
      : row.on
        ? t(`dash.urgent.${row.key}.on`, { date: day(row.on) })
        : t(`dash.urgent.${row.key}.note`);
  const link = "font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Link href="/cohorts" className="rounded-md px-4 py-2.5 text-sm font-semibold text-white" style={{ background: "var(--brand-primary)" }}>
          {t("dash.action.newCohort")}
        </Link>
        <Link href="/people" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold">
          {t("dash.action.people")}
        </Link>
        <Link href="/qualifications" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold">
          {t("dash.action.qualification")}
        </Link>
      </div>

      <Card section={{ id: "today", label: t("dash.today") }} title={t("dash.today")} description={t("dash.todayIntro")}>
        {data.urgent.length === 0 ? (
          <p className="text-sm text-[var(--success)]">{t("dash.nothingUrgent")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.urgent.map((row) => (
              <Link
                key={row.key}
                href={row.href}
                className="group flex flex-col rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)] hover:bg-[var(--background)] focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
              >
                <span className={`text-2xl font-bold tabular-nums ${TONE[row.tone]}`}>{row.count}</span>
                <span className="font-medium group-hover:underline">{urgentLabel(row.key, row.count)}</span>
                <span className="text-xs text-[var(--muted)]">{urgentDetail(row)}</span>
                <span className="mt-2 text-xs font-semibold text-[var(--brand-primary)]">
                  {row.count === 1 ? t("dash.openOne") : t(`dash.openMany.${row.key}`)} →
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card section={{ id: "running", label: t("dash.running") }} title={t("dash.running")}>
            {data.running.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("dash.runningNone")}</p>
            ) : (
              <ul className="space-y-3">
                {data.running.map((row) => (
                  <li key={row.id}>
                    <Link href={`/cohorts/${row.id}`} className="block rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]">
                      <div className="flex flex-wrap justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold">{row.name}</p>
                          {row.programme ? <p className="text-xs text-[var(--muted)]">{row.programme}</p> : null}
                        </div>
                        <div className="text-right text-xs text-[var(--muted)]">
                          <p>{row.learners === 1 ? t("dash.oneLearner") : t("dash.learners", { count: row.learners })}</p>
                          {row.attendancePercent !== null ? <p>{t("dash.attendance", { percent: row.attendancePercent })}</p> : null}
                        </div>
                      </div>
                      {row.weeks ? (
                        <div className="mt-2 flex items-center gap-3">
                          <div className="h-2 flex-1 rounded-full bg-[var(--border)]">
                            <div className="h-2 rounded-full bg-[var(--brand-accent)]" style={{ width: `${row.elapsedPercent ?? 0}%` }} />
                          </div>
                          <span className="shrink-0 text-xs text-[var(--muted)]">{t("dash.weekOf", { week: Math.min(row.week, row.weeks), weeks: row.weeks })}</span>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--muted)]">{t("dash.week", { week: row.week })}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span>
                          <span className="text-[var(--muted)]">{t("dash.next")} </span>
                          {row.next ? `${day(row.next.date)}${row.next.startTime ? ` ${row.next.startTime}` : ""}, ${sessionName(row.next)}` : t("dash.nextNone")}
                        </span>
                        {row.facilitator ? (
                          <span>
                            <span className="text-[var(--muted)]">{t("dash.facilitator")} </span>
                            {row.facilitator}
                          </span>
                        ) : null}
                        {row.missingStep ? (
                          <span className={`font-medium ${WARNING}`}>{t("dash.missingStep", { step: t(`cohortNav.step.${row.missingStep}`) })}</span>
                        ) : null}
                        {row.heldUp > 0 ? (
                          <span className={`font-medium ${WARNING}`}>{row.heldUp === 1 ? t("dash.heldUpOne") : t("dash.heldUp", { count: row.heldUp })}</span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm">
              <Link href="/cohorts" className={link}>{t("dash.allCohorts")} →</Link>
            </p>
          </Card>

          {data.setup.length > 0 ? (
            <Card section={{ id: "setup", label: t("dash.setup") }} title={t("dash.setup")} description={t("dash.setupIntro")}>
              <ul className="divide-y divide-[var(--border)]">
                {data.setup.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/cohorts/${row.id}`} className="font-medium hover:underline">{row.name}</Link>
                      <p className="text-xs text-[var(--muted)]">
                        {t("dash.setupDetail", { date: day(row.startDate) })} ·{" "}
                        {row.learners === 1 ? t("dash.oneLearner") : t("dash.learners", { count: row.learners })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--muted)]">{t("dash.step", { step: row.step })}</span>
                      <Link href={STEP_HREF(row.id, row.next)} className="rounded-md border border-[var(--brand-primary)] px-3 py-1.5 font-medium text-[var(--brand-primary)]">
                        {t(`cohortNav.step.${row.next}`)} →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card section={{ id: "risk", label: t("dash.risk") }} title={t("dash.risk")} description={t("dash.riskIntro")}>
            {data.atRisk.length === 0 ? (
              <p className="text-sm text-[var(--success)]">{t("dash.riskNone")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                      <th className="pb-2 pr-3">{t("dash.learner")}</th>
                      <th className="pb-2 pr-3">{t("dash.cohort")}</th>
                      <th className="pb-2">{t("dash.why")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.atRisk.map((row) => (
                      <tr key={`${row.cohortId}-${row.userId}`} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3">
                          <Link href={`/people/${row.userId}`} className="font-medium hover:underline">{row.name}</Link>
                        </td>
                        <td className="py-2 pr-3 text-[var(--muted)]">
                          <Link href={`/cohorts/${row.cohortId}`} className="hover:underline">{row.cohortName}</Link>
                        </td>
                        <td className="py-2">
                          {row.reason === "blocked"
                            ? t("dash.why.blocked", { step: row.detail })
                            : t("dash.why.absent", { dates: row.detail.split(",").map((date) => day(date, { short: true })).reverse().join(", ") })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-sm">
              <Link href="/tracker" className={link}>{t("dash.tracker")} →</Link>
            </p>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card section={{ id: "timetable", label: t("dash.timetable") }} title={t("dash.timetable")}>
            {data.today.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("dash.timetableNone")}</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.today.map((row) => (
                  <li key={row.sessionId} className="flex gap-3">
                    <span className="w-12 shrink-0 font-semibold tabular-nums">{row.startTime ?? ""}</span>
                    <div className="min-w-0">
                      <p className="font-medium">{sessionName(row)}</p>
                      <p className="text-xs text-[var(--muted)]">{row.cohortName}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                        {row.meetingUrl ? (
                          <a href={row.meetingUrl} target="_blank" rel="noreferrer" className={link}>{t("dash.join")}</a>
                        ) : null}
                        <Link href={`/cohorts/${row.cohortId}/sessions/${row.sessionId}`} className={link}>{t("dash.register")}</Link>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card section={{ id: "due", label: t("dash.due") }} title={t("dash.due")}>
            {data.due.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("dash.dueNone")}</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {data.due.map((row, index) => (
                  <li key={`${row.kind}-${row.cohortId}-${index}`}>
                    <Link href={row.kind === "summative" ? `/cohorts/${row.cohortId}#sessions` : `/cohorts/${row.cohortId}#leisa`} className="flex gap-3 py-2 hover:underline">
                      <span className={`w-20 shrink-0 text-xs font-semibold ${row.overdue ? "text-[var(--danger)]" : ""}`}>{day(row.date, { short: true })}</span>
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {t(`dash.due.${row.kind}`)}
                          {row.overdue ? <span className="ml-2 text-xs font-semibold text-[var(--danger)]">{t("dash.overdue")}</span> : null}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">{row.cohortName}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.qualifications.length > 0 ? (
            <Card section={{ id: "building", label: t("dash.building") }} title={t("dash.building")}>
              <ul className="space-y-3 text-sm">
                {data.qualifications.map((row) => (
                  <li key={row.id}>
                    <p className="font-medium">{row.title}{row.saqaId ? ` · ${row.saqaId}` : ""}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {row.blocking > 0 ? t("dash.buildingBlocking", { count: row.blocking }) : t("dash.buildingReady")}
                      {row.toCheck > 0 ? ` ${t("dash.buildingCheck", { count: row.toCheck })}` : ""}
                    </p>
                    <Link href={`/qualifications/${row.id}/verify`} className={`text-xs ${link}`}>{t("qualNav.verify")} →</Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card section={{ id: "others", label: t("dash.others") }} title={t("dash.others")} description={t("dash.othersIntro")}>
            <ul className="divide-y divide-[var(--border)] text-sm">
              <li>
                <Link href={data.waiting.assessHref} className="flex justify-between gap-3 py-2 hover:underline">
                  <span>{t("dash.others.assess", { count: data.waiting.toAssess })}</span>
                  <span className="text-xs text-[var(--muted)]">{t("role.assessor")}</span>
                </Link>
              </li>
              <li>
                <Link href={data.waiting.moderateHref} className="flex justify-between gap-3 py-2 hover:underline">
                  <span>{t("dash.others.moderate", { count: data.waiting.toModerate })}</span>
                  <span className="text-xs text-[var(--muted)]">{t("role.moderator")}</span>
                </Link>
              </li>
              <li>
                <Link href="/workplace" className="flex justify-between gap-3 py-2 hover:underline">
                  <span>{t("dash.others.coaches", { count: data.waiting.withCoaches })}</span>
                  <span className="text-xs text-[var(--muted)]">{t("dash.coaches")}</span>
                </Link>
              </li>
            </ul>
          </Card>

          <Card section={{ id: "feedback", label: t("dash.feedback") }} title={t("dash.feedback")}>
            {data.feedback.responses === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("dash.feedbackNone")}</p>
            ) : (
              <p className="text-sm">
                {data.feedback.responses === 1 ? t("dash.feedbackOne") : t("dash.feedbackMany", { count: data.feedback.responses })}{" "}
                {data.feedback.cohortId ? (
                  <Link href={`/cohorts/${data.feedback.cohortId}#feedback`} className={link}>
                    {t("dash.feedbackLatest", { cohort: data.feedback.cohortName ?? "" })} →
                  </Link>
                ) : null}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
