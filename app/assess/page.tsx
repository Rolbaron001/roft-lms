import Link from "next/link";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { listAssessorQueue } from "@/lib/assessment";
import { AppShell, Card } from "@/components/app-shell";
import { AssignedNote } from "@/components/assigned-note";

export default async function AssessorQueuePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:assess");
  const { t, day } = await pageLocale();
  const queue = await listAssessorQueue(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <AssignedNote session={session} />
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("assessing.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("assessing.intro")}
        </p>
      </div>

      {queue.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t("assessing.empty")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map((row) => (
            <Link
              key={row.submissionId}
              href={`/assess/${row.submissionId}`}
              className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--brand-accent)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {row.learnerFirstName} {row.learnerLastName}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {row.assessmentTitle}
                    {row.courseTitle ? ` · ${row.courseTitle}` : ""}
                  </p>
                </div>
                <div className="text-right text-xs text-[var(--muted)]">
                  {row.purpose === "summative" ? (
                    <span className="font-medium text-[var(--brand-accent)]">
                      {t("common.summative")}
                    </span>
                  ) : (
                    t("common.formative")
                  )}
                  <span className="block">
                    {t("common.attempt", { number: row.attemptNumber })}
                    {row.maxScore
                      ? ` · ${t("common.scoredOf", { score: row.autoScore ?? 0, max: row.maxScore })}`
                      : ""}
                  </span>
                  <span className="block">
                    {day(row.submittedAt, { short: true })}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
