import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listAssessorQueue } from "@/lib/assessment";
import { AppShell, Card } from "@/components/app-shell";

export default async function AssessorQueuePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:assess");
  const queue = await listAssessorQueue(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Waiting to be assessed</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Submissions ready for a competency judgement. You cannot assess your
          own work, and a proportion of your decisions will be reviewed
          independently by a moderator.
        </p>
      </div>

      {queue.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            Nothing is waiting. Submissions appear here as learners send them
            in.
          </p>
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
                      Summative
                    </span>
                  ) : (
                    "Formative"
                  )}
                  <span className="block">
                    attempt {row.attemptNumber}
                    {row.maxScore
                      ? ` · scored ${row.autoScore} of ${row.maxScore}`
                      : ""}
                  </span>
                  <span className="block">
                    {row.submittedAt
                      ? row.submittedAt.toLocaleDateString("en-ZA")
                      : ""}
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
