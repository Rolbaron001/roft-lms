import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
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
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const rows = await cohortReadiness(session);

  const eligible = rows.filter((row) => row.eisaEligible);
  const incomplete = rows.filter((row) => !row.curriculumComplete);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">EISA readiness</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          A learner may sit the External Integrated Summative Assessment once
          every internal assessment criterion in every module has been
          achieved. Not most of them, and no percentage stands in for it — the
          percentage below is progress, the badge is permission.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            Nobody is enrolled against a qualification yet. Enrol a learner on a
            course and choose the qualification it counts towards, and they will
            appear here.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Ready for the EISA
              </p>
              <p className="mt-1 text-2xl font-semibold">{eligible.length}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Working towards one
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {rows.length - eligible.length}
              </p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
                Learners tracked
              </p>
              <p className="mt-1 text-2xl font-semibold">{rows.length}</p>
            </Card>
          </div>

          {incomplete.length > 0 ? (
            <div
              className="mb-6 rounded-lg border-2 p-4"
              style={{ borderColor: "var(--danger)" }}
            >
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--danger)" }}
              >
                A curriculum here is not fully captured.
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Some modules carry no assessment criteria, so nothing can be
                achieved against them and nobody on that qualification can be
                declared ready. Import the full curriculum document before
                entering anyone for an EISA.
              </p>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Learner</th>
                  <th className="px-4 py-3 font-medium">Qualification</th>
                  <th className="px-4 py-3 font-medium">Criteria</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">EISA</th>
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
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {row.qualificationTitle}
                    </td>
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
                        <span className="tabular-nums text-[var(--muted)]">
                          {row.readinessIndex}%
                        </span>
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
                          Eligible
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">
                          {row.outstandingCount} outstanding
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
