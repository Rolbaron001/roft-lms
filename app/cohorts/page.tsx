import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listCohorts } from "@/lib/cohorts";
import { listCourses } from "@/lib/authoring";
import { EmptyState } from "@/components/empty-state";
import { AppShell, StatusBadge } from "@/components/app-shell";
import { NewCohort } from "./new-cohort";
import { RosterForm } from "@/app/people/roster-form";
import { Card } from "@/components/ui";
import { extensionState } from "@/lib/extensions";

/**
 * The cohorts a provider is running.
 *
 * The difference between a system that holds a programme and one that runs
 * it: a group with a start date, and every deadline measured from it.
 */
export default async function CohortsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  // A cohort usually arrives as a spreadsheet of names, so the same import that
  // sits under People is offered here too - this is where somebody is when
  // they have one in front of them.
  const canInvite = session.permissions.includes("user:invite");
  const extension = canInvite ? await extensionState(session) : null;
  const cohorts = await listCohorts(session);

  // Only fetched for somebody who can actually start one: listCourses asks for
  // a permission a read-only viewer of this page does not necessarily hold.
  const canManage = session.permissions.includes("enrolment:manage");
  const courses = canManage ? await listCourses(session) : [];

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

      {canManage ? (
        <div className="mb-6">
          <NewCohort
            courses={courses.map((course) => ({
              id: course.id,
              title: course.title,
              status: course.status,
              version: course.version,
            }))}
          />
        </div>
      ) : null}

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

      {canInvite ? (
        <div className="mt-6">
          <Card
            title="Add a cohort from a spreadsheet"
            description="Read a CSV or Excel file of learners and create them all at once. It shows you what it made of the file before anybody is created, then enrol them onto a cohort above."
          >
            <RosterForm
              extension={
                session.permissions.includes("extension:use") && extension
                  ? {
                      enabled: extension.enabled,
                      available: extension.availability?.available ?? false,
                    }
                  : null
              }
            />
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
