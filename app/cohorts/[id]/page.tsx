import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { CohortError, getCohort } from "@/lib/cohorts";
import { blockedLearners } from "@/lib/spine";
import { AppShell, Card } from "@/components/app-shell";

/**
 * One cohort: who is on it, what the schedule says, and who is stuck.
 *
 * The blocked list comes first deliberately. It is the only part a facilitator
 * has to act on today; the schedule and the register are reference.
 */
export default async function CohortPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  let detail;
  try {
    detail = await getCohort(session, id);
  } catch (error) {
    if (error instanceof CohortError) notFound();
    throw error;
  }

  const blocked = await blockedLearners(session, detail.cohort.courseId);
  const active = detail.members.filter((member) => member.leftAt === null);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/cohorts" className="text-sm text-[var(--muted)] hover:underline">
          ← Cohorts
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{detail.cohort.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Starts {detail.cohort.startDate} · {active.length}{" "}
          {active.length === 1 ? "learner" : "learners"}
        </p>
      </div>

      {blocked.length > 0 ? (
        <Card
          title={`Waiting on something (${blocked.length})`}
          description="Each learner once, at the earliest step they cannot open."
        >
          <ul className="space-y-2">
            {blocked.map((row) => (
              <li
                key={row.userId}
                className="rounded-md border border-[var(--border)] px-4 py-3 text-sm"
              >
                <span className="font-medium">
                  {row.firstName} {row.lastName}
                </span>
                <span className="mt-0.5 block">
                  Stuck at <strong>{row.stepTitle}</strong>
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  Opens when {row.blockedBy.join("; and when ")}.
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-6">
        <Card
          title="The schedule"
          description="Held as days from the start. Change the start date and every one of these moves with it."
        >
          {detail.steps.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              This cohort&rsquo;s course has no steps yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">Step</th>
                    <th className="pb-2">Opens</th>
                    <th className="pb-2">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.steps.map((step) => (
                    <tr key={step.id} className="border-t border-[var(--border)]">
                      <td className="py-2">{step.title ?? step.kind}</td>
                      <td className="py-2 tabular-nums">
                        {step.opensAt
                          ? step.opensAt.toISOString().slice(0, 10)
                          : "—"}
                        {step.opensAfterDays !== null ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            day {step.opensAfterDays}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 tabular-nums">
                        {step.dueAt
                          ? step.dueAt.toISOString().slice(0, 10)
                          : "—"}
                        {step.dueAfterDays !== null ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            day {step.dueAfterDays}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title={`On this cohort (${active.length})`}>
          <ul className="space-y-1 text-sm">
            {detail.members.map((member) => (
              <li
                key={member.userId}
                className={member.leftAt ? "opacity-60" : ""}
              >
                {member.firstName} {member.lastName}
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {member.email}
                  {member.leftAt
                    ? ` · left ${member.leftAt.toISOString().slice(0, 10)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
