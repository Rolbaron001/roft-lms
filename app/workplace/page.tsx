import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { myLogbooks } from "@/lib/workplace";
import { AppShell, Card } from "@/components/app-shell";

const STATUS_LABELS: Record<string, string> = {
  draft: "With the learner",
  submitted_to_coach: "Waiting for the coach",
  returned_by_coach: "Sent back to the learner",
  coach_signed: "Signed — with the assessor",
  accepted_by_assessor: "Received by the assessor",
};

/**
 * Work experience logbooks.
 *
 * One page for four different people. A learner sees their own; a workplace
 * coach sees only the learners they hold an agreement with; provider staff see
 * everything. The filtering happens in the data layer, because "only mine" is
 * not something a permission can express.
 */
export default async function WorkplacePage() {
  const tenant = await requireTenant();
  const session = await requireSession();
  const logbooks = await myLogbooks(session);

  const isCoach = session.permissions.includes("workplace:sign");
  const waiting = logbooks.filter(
    (row) => row.status === "submitted_to_coach",
  ).length;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Work experience</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {isCoach
            ? "The learners you supervise. You confirm what they did in the workplace; nothing reaches an assessor without your signature."
            : "Work experience is done at an employer and signed off by the workplace coach there. The order is fixed: you record it, your coach confirms it, then it goes to an assessor."}
        </p>
      </div>

      {isCoach && waiting > 0 ? (
        <div
          className="mb-6 rounded-lg border-2 p-4"
          style={{ borderColor: "var(--brand-accent)" }}
        >
          <p className="text-sm font-semibold">
            {waiting} {waiting === 1 ? "logbook is" : "logbooks are"} waiting for
            your signature.
          </p>
        </div>
      ) : null}

      {logbooks.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No work experience logbooks yet. An administrator opens one once a
            workplace agreement is in place naming the learner, the employer and
            the coach.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">Module</th>
                <th className="px-4 py-3 font-medium">Learner</th>
                <th className="px-4 py-3 font-medium">Employer</th>
                <th className="px-4 py-3 font-medium">Status</th>
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
                      {STATUS_LABELS[row.status] ?? row.status}
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
