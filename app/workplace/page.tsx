import Link from "next/link";
import { requireCapability, requireSession } from "@/lib/request";
import { vocabulary } from "@/lib/terms";
import { myLogbooks } from "@/lib/workplace";
import { AppShell, Card } from "@/components/app-shell";
import { maybe, translator } from "@/lib/i18n";
import { localeFor } from "@/lib/i18n/locales";

/**
 * Work experience logbooks.
 *
 * One page for four different people. A learner sees their own; a workplace
 * coach sees only the learners they hold an agreement with; provider staff see
 * everything. The filtering happens in the data layer, because "only mine" is
 * not something a permission can express.
 */
export default async function WorkplacePage() {
  const tenant = await requireCapability("workplace_experience");
  const session = await requireSession();
  const logbooks = await myLogbooks(session);
  const locale = localeFor(tenant, session);
  const t = translator(locale);
  // The client calls this a workplace experience sign-off rather than a
  // logbook (27 August). Both words are in use in the sector, so it is the
  // tenant's to choose rather than the platform's to insist on.
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);

  const isCoach = session.permissions.includes("workplace:sign");
  const canManage = session.permissions.includes("workplace:manage");
  const waiting = logbooks.filter(
    (row) => row.status === "submitted_to_coach",
  ).length;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("work.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {isCoach ? t("work.introCoach") : t("work.introLearner")}
        </p>
        {canManage ? (
          <p className="mt-3">
            <Link
              href="/workplace/setup"
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              {t("work.setUp")}
            </Link>
          </p>
        ) : null}
      </div>

      {isCoach && waiting > 0 ? (
        <div
          className="mb-6 rounded-lg border-2 p-4"
          style={{ borderColor: "var(--brand-accent)" }}
        >
          <p className="text-sm font-semibold">
            {waiting === 1
              ? t("work.waitingOne", { record: words.lowerOne("workplaceRecord") })
              : t("work.waitingMany", { count: waiting, records: words.lowerMany("workplaceRecord") })}
          </p>
        </div>
      ) : null}

      {logbooks.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            {t(canManage ? "work.noneManage" : "work.none", {
              records: words.lowerMany("workplaceRecord"),
            })}
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">{t("work.module")}</th>
                <th className="px-4 py-3 font-medium">{words.one("learner")}</th>
                <th className="px-4 py-3 font-medium">{t("work.employer")}</th>
                <th className="px-4 py-3 font-medium">{t("work.status")}</th>
              </tr>
            </thead>
            <tbody>
              {logbooks.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/workplace/${row.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {row.moduleTitle}
                    </Link>
                    <p className="font-mono text-xs text-[var(--muted)]">
                      {row.moduleCode}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {row.learnerFirst} {row.learnerLast}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {row.employerName}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={
                        row.status === "coach_signed" ||
                        row.status === "accepted_by_assessor"
                          ? {
                              background:
                                "color-mix(in srgb, var(--success) 15%, transparent)",
                              color: "var(--success)",
                            }
                          : { color: "var(--muted)" }
                      }
                    >
                      {maybe(t, `work.status.${row.status}`) ?? row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
