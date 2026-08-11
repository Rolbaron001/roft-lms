import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listLearningPaths } from "@/lib/learning-paths";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { NewPathForm } from "./new-path-form";

export default async function PathsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");
  const paths = await listLearningPaths(session);

  const canAuthor = session.permissions.includes("course:author");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Programmes</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Several courses chained into a sequence — a new starter programme, or
          a full competency framework roll-out. A learner is given the next
          course automatically as they finish the one before it.
        </p>
      </div>

      {paths.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No programmes yet.
            {canAuthor ? " Create one below." : ""}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {paths.map((path) => (
            <Link
              key={path.id}
              href={`/paths/${path.id}`}
              className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--brand-accent)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{path.title}</p>
                  {path.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">
                      {path.description}
                    </p>
                  ) : null}
                </div>
                <StatusBadge status={path.status} />
              </div>

              {path.steps.length > 0 ? (
                <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                  {path.steps.map((step, index) => (
                    <li key={step.courseId} className="flex items-center gap-2">
                      {index > 0 ? (
                        <span aria-hidden className="opacity-50">
                          →
                        </span>
                      ) : null}
                      <span>{step.courseTitle}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  No courses in it yet.
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      {canAuthor ? (
        <div className="mt-6">
          <NewPathForm />
        </div>
      ) : null}
    </AppShell>
  );
}
