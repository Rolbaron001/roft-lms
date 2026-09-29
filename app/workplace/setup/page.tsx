import Link from "next/link";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { workplaceSetupData } from "@/lib/workplace";
import { AppShell, Card } from "@/components/app-shell";
import { AgreementForm, LogbookForm } from "./setup-forms";

function formatDate(value: Date | null, dates: string): string {
  if (!value) return "—";
  return value.toLocaleDateString(dates, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Setting up work experience: who is placed where, under whom, and which
 * modules they are working through.
 *
 * Staff only. The coach's own view is /workplace, which shows their learners
 * and nothing else.
 */
export default async function WorkplaceSetupPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("workplace:manage");
  const { t, dates } = await pageLocale();
  const { learners, coaches, modules, agreements } =
    await workplaceSetupData(session);

  const untranscribed = modules.filter((entry) => entry.elementCount === 0);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/workplace"
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          {t("wpSetup.back")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("wpSetup.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("wpSetup.intro")}</p>
      </div>

      {untranscribed.length > 0 ? (
        <div
          className="mb-6 rounded-lg border-2 p-4"
          style={{ borderColor: "var(--danger)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
            {untranscribed.length === 1
              ? t("wpSetup.emptyOne")
              : t("wpSetup.empty", { count: untranscribed.length })}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("wpSetup.emptyNote", { codes: untranscribed.map((entry) => entry.code).join(", ") })}
          </p>
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">{t("wpSetup.agreement")}</h2>
        <Card>
          <AgreementForm learners={learners} coaches={coaches} />
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">{t("wpSetup.logbook")}</h2>
        <Card>
          <LogbookForm agreements={agreements} modules={modules} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">{t("wpSetup.inPlace")}</h2>
        {agreements.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--muted)]">{t("wpSetup.none")}</p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("wpSetup.learner")}</th>
                  <th className="px-4 py-3 font-medium">{t("wpSetup.employer")}</th>
                  <th className="px-4 py-3 font-medium">{t("wpSetup.coach")}</th>
                  <th className="px-4 py-3 font-medium">{t("wpSetup.dates")}</th>
                  <th className="px-4 py-3 font-medium">{t("wpSetup.logbooks")}</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((agreement) => (
                  <tr
                    key={agreement.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      {agreement.learnerFirst} {agreement.learnerLast}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {agreement.employerName}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {agreement.coachName}
                      {agreement.coachDesignation
                        ? ` · ${agreement.coachDesignation}`
                        : ""}
                      <p className="text-xs">{agreement.coachEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {formatDate(agreement.startDate, dates)} –{" "}
                      {formatDate(agreement.endDate, dates)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--muted)]">
                      {agreement.moduleIdsOpen.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
