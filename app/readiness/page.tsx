import Link from "next/link";
import { pageT, requireCapability, requirePermission } from "@/lib/request";
import { cohortReadiness } from "@/lib/eisa";
import { AppShell, Card } from "@/components/app-shell";

/**
 * The Skills Development Facilitator's view: who can be entered for the next
 * EISA sitting.
 *
 * Ordered by eligibility first and progress second, because the question this
 * page exists to answer is "who can go", not "who is doing well".
 */
export default async function ReadinessPage() {
  const tenant = await requireCapability("qualifications");
  const session = await requirePermission("enrolment:read_all");
  const t = await pageT();
  const rows = await cohortReadiness(session);

  const eligible = rows.filter((row) => row.eisaEligible);
  const incomplete = rows.filter((row) => !row.curriculumComplete);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("ready.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("ready.intro")}</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t("ready.nobody")}</p>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{t("ready.readyCount")}</p>
              <p className="mt-1 text-2xl font-semibold">{eligible.length}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{t("ready.working")}</p>
              <p className="mt-1 text-2xl font-semibold">{rows.length - eligible.length}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{t("ready.tracked")}</p>
              <p className="mt-1 text-2xl font-semibold">{rows.length}</p>
            </Card>
          </div>

          {incomplete.length > 0 ? (
            <div className="mb-6 rounded-lg border-2 p-4" style={{ borderColor: "var(--danger)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                {t("ready.notCaptured")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">{t("ready.notCapturedIntro")}</p>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("ready.learner")}</th>
                  <th className="px-4 py-3 font-medium">{t("ready.qualification")}</th>
                  <th className="px-4 py-3 font-medium">{t("ready.criteria")}</th>
                  <th className="px-4 py-3 font-medium">{t("ready.progress")}</th>
                  <th className="px-4 py-3 font-medium">{t("ready.eisa")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.userId}-${row.qualificationId}`}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/readiness/${row.qualificationId}/${row.userId}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {row.firstName} {row.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">{row.qualificationTitle}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {row.achievedCriteria} / {row.totalCriteria}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--border)]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${row.readinessIndex}%`,
                              background: "var(--brand-accent)",
                            }}
                          />
                        </div>
                        <span className="tabular-nums text-[var(--muted)]">{row.readinessIndex}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.eisaEligible ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{
                            background: "color-mix(in srgb, var(--success) 15%, transparent)",
                            color: "var(--success)",
                          }}
                        >
                          {t("ready.eligible")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">
                          {t("ready.outstanding", { count: row.outstandingCount })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
