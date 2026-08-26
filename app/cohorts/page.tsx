import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listCohorts } from "@/lib/cohorts";
import { EmptyState } from "@/components/empty-state";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";

/**
 * The cohorts a provider is running.
 *
 * The difference between a system that holds a programme and one that runs
 * it: a group with a start date, and every deadline measured from it.
 */
export default async function CohortsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const cohorts = await listCohorts(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Cohorts</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          A group working through a programme together, on one schedule. Every
          deadline is held as a number of days from the start date, so moving an
          intake moves every date for everyone in it at once.
        </p>
      </div>

      {cohorts.length === 0 ? (
        <EmptyState title="No cohorts yet">
          A cohort is a group working through a published course together, on
          one schedule. Create one against a course and every deadline is
          measured from its start date.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {cohorts.map((cohort) => (
            <li
              key={cohort.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <span className="text-sm">
                <span className="font-medium">{cohort.name}</span>
                {cohort.code ? (
                  <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                    {cohort.code}
                  </span>
                ) : null}
                <span className="block text-xs text-[var(--muted)]">
                  {cohort.courseTitle} · starts {cohort.startDate}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <StatusBadge status={cohort.status} />
                <Link
                  href={`/cohorts/${cohort.id}`}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
                >
                  Open
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
