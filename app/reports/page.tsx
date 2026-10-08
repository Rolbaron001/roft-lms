import Link from "next/link";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import {
  capabilityCoverage,
  courseCompletion,
  filterOptions,
  headlineNumbers,
  overdueTraining,
  scopeFor,
} from "@/lib/reporting";
import { AppShell, Card } from "@/components/app-shell";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "success";
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <p
        className="text-2xl font-semibold"
        style={
          tone === "danger"
            ? { color: "var(--danger)" }
            : tone === "success"
              ? { color: "var(--success)" }
              : undefined
        }
      >
        {value}
      </p>
      <p className="mt-1 text-sm text-[var(--muted)]">{label}</p>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; site?: string }>;
}) {
  const { team, site } = await searchParams;
  const tenant = await requireTenant();
  const session = await requirePermission("report:own");
  const t = await pageT();

  const filters = { team: team || undefined, site: site || undefined };

  const [headline, capability, completion, overdue, options] =
    await Promise.all([
      headlineNumbers(session, filters),
      capabilityCoverage(session, filters),
      courseCompletion(session, filters),
      overdueTraining(session, filters),
      filterOptions(session),
    ]);

  const scope = scopeFor(session);
  const gaps = capability.filter((row) => row.noCoverage);
  const singlePoints = capability.filter((row) => row.singlePointOfFailure);

  const query = new URLSearchParams();
  if (filters.team) query.set("team", filters.team);
  if (filters.site) query.set("site", filters.site);
  const exportQuery = query.toString();

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("reports.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {scope.kind === "tenant"
            ? t("reports.scope.tenant")
            : scope.kind === "team"
              ? t("reports.scope.team")
              : t("reports.scope.self")}
        </p>

        {scope.kind === "tenant" ? (
          <Link
            href="/reports/programme"
            className="mt-3 inline-block rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
          >
            {t("reports.programme")}
          </Link>
        ) : null}
      </div>

      {options.teams.length > 0 || options.sites.length > 0 ? (
        <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
          {options.teams.length > 0 ? (
            <label className="space-y-1.5">
              <span className="block text-sm font-medium">{t("reports.team")}</span>
              <select
                name="team"
                defaultValue={filters.team ?? ""}
                className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              >
                <option value="">{t("reports.allTeams")}</option>
                {options.teams.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {options.sites.length > 0 ? (
            <label className="space-y-1.5">
              <span className="block text-sm font-medium">{t("reports.site")}</span>
              <select
                name="site"
                defaultValue={filters.site ?? ""}
                className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              >
                <option value="">{t("reports.allSites")}</option>
                {options.sites.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            type="submit"
            className="rounded-md px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--brand-primary)" }}
          >
            {t("reports.apply")}
          </button>

          {filters.team || filters.site ? (
            <Link
              href="/reports"
              className="px-2 py-2 text-sm text-[var(--muted)] hover:underline"
            >
              {t("reports.clear")}
            </Link>
          ) : null}
        </form>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("reports.people")} value={headline.people} />
        <Stat label={t("reports.assigned")} value={headline.enrolments} />
        <Stat
          label={t("reports.rate")}
          value={`${headline.completionRate}%`}
          tone={headline.completionRate >= 80 ? "success" : undefined}
        />
        <Stat
          label={t("reports.overdue")}
          value={headline.overdue}
          tone={headline.overdue > 0 ? "danger" : undefined}
        />
      </div>

      <div className="mt-6 space-y-6">
        {/* The report the platform exists for. */}
        <section id="coverage" className="scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                {t("reports.coverage")}
              </h2>
              <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">{t("reports.coverageNote")}</p>
            </div>
            <a
              href={`/reports/export/capability${exportQuery ? `?${exportQuery}` : ""}`}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
            >
              {t("reports.export")}
            </a>
          </div>

          {capability.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">{t("reports.noCompetencies")}</p>
          ) : (
            <>
              {singlePoints.length > 0 || gaps.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {singlePoints.length > 0 ? (
                    <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3">
                      <p className="text-sm font-medium text-[var(--danger)]">
                        {singlePoints.length === 1
                          ? t("reports.singleOne")
                          : t("reports.single", { count: singlePoints.length })}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {t("reports.singleNote", { codes: singlePoints.map((row) => row.code).join(", ") })}
                      </p>
                    </div>
                  ) : null}

                  {gaps.length > 0 ? (
                    <div className="rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-4 py-3">
                      <p className="text-sm font-medium">{t("reports.gaps", { count: gaps.length })}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {t("reports.gapsNote", { codes: gaps.map((row) => row.code).join(", ") })}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-lg text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                      <th className="pb-2 pr-4 font-medium">{t("reports.competency")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("reports.holders")}</th>
                      <th className="pb-2 pr-4 font-medium">{t("reports.coverageCol")}</th>
                      <th className="pb-2 font-medium">{t("reports.risk")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capability.map((row) => (
                      <tr
                        key={row.code}
                        className="border-b border-[var(--border)] last:border-0"
                      >
                        <td className="py-2.5 pr-4">
                          <span className="font-medium">{row.code}</span>{" "}
                          {row.name}
                        </td>
                        <td className="py-2.5 pr-4 whitespace-nowrap">
                          {t("reports.holdersOf", { holders: row.holders, population: row.population })}
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--border)]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${row.coverage}%`,
                                  background:
                                    row.holders === 0
                                      ? "var(--danger)"
                                      : "var(--brand-accent)",
                                }}
                              />
                            </div>
                            <span className="text-xs text-[var(--muted)]">
                              {row.coverage}%
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 text-xs">
                          {row.noCoverage ? (
                            <span className="font-medium text-[var(--danger)]">
                              {t("reports.noCoverage")}
                            </span>
                          ) : row.singlePointOfFailure ? (
                            <span className="font-medium text-[var(--danger)]">
                              {t("reports.singlePoint")}
                            </span>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <Card section={{ id: "by-course", label: t("reports.byCourse") }} title={t("reports.byCourse")}>
          {completion.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("reports.nobodyEnrolled")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-lg text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2 pr-4 font-medium">{t("reports.course")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("reports.enrolled")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("reports.completed")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("reports.overdue")}</th>
                    <th className="pb-2 font-medium">{t("reports.rateCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {completion.map((row) => (
                    <tr
                      key={row.courseId}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="py-2.5 pr-4">{row.title}</td>
                      <td className="py-2.5 pr-4">{row.enrolled}</td>
                      <td className="py-2.5 pr-4">{row.completed}</td>
                      <td className="py-2.5 pr-4">
                        {row.overdue > 0 ? (
                          <span className="font-medium text-[var(--danger)]">
                            {row.overdue}
                          </span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="py-2.5">{row.completionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <section id="overdue" className="scroll-mt-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              {t("reports.overdueTraining")}
            </h2>
            {overdue.length > 0 ? (
              <a
                href={`/reports/export/overdue${exportQuery ? `?${exportQuery}` : ""}`}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
              >
                {t("reports.export")}
              </a>
            ) : null}
          </div>

          {overdue.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">{t("reports.nothingOverdue")}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-lg text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2 pr-4 font-medium">{t("reports.person")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("reports.course")}</th>
                    <th className="pb-2 font-medium">{t("reports.overdueBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((row, index) => (
                    <tr
                      key={`${row.userId}-${index}`}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="py-2.5 pr-4">
                        {row.firstName} {row.lastName}
                        <span className="block text-xs text-[var(--muted)]">
                          {row.team ?? row.email}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">{row.courseTitle}</td>
                      <td className="py-2.5 whitespace-nowrap text-[var(--danger)]">
                        {row.daysOverdue === 1
                          ? t("reports.dayOne")
                          : t("reports.days", { count: row.daysOverdue })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
