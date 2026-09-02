import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  HOURS_TO_ACKNOWLEDGE,
  acknowledgementDue,
  openAppeals,
} from "@/lib/appeals";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { ZonedTime } from "@/components/zoned-time";

const GROUND_LABEL: Record<string, string> = {
  result: "Against a result",
  assessor_conduct: "Against an assessor's conduct",
};

const STATUS_LABEL: Record<string, string> = {
  lodged: "Lodged",
  acknowledged: "Acknowledged",
  under_review: "Under review",
  resolved: "Resolved",
  withdrawn: "Withdrawn",
};

function overdueFor(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"} over`;
  }
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} over`;
  return `${Math.floor(seconds / 60)} minutes over`;
}

/**
 * The appeals that are still open.
 *
 * Led by what is out of time rather than by what is newest, because the whole
 * reason this is not a spreadsheet is that a spreadsheet cannot tell anybody
 * an acknowledgement is late while there is still time to make it.
 */
export default async function AppealsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("appeal:manage");

  const now = new Date();
  const open = await openAppeals(session);

  const withClock = open.map((appeal) => ({
    ...appeal,
    clock: acknowledgementDue({
      lodgedAt: appeal.lodgedAt,
      acknowledgedAt: appeal.acknowledgedAt,
      now,
    }),
  }));

  const overdue = withClock
    .filter((appeal) => appeal.clock.overdueBySeconds > 0)
    .sort((a, b) => b.clock.overdueBySeconds - a.clock.overdueBySeconds);
  const rest = withClock.filter((appeal) => appeal.clock.overdueBySeconds === 0);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Appeals</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          A learner may appeal against a result or against an assessor&rsquo;s
          conduct. Receipt is acknowledged within {HOURS_TO_ACKNOWLEDGE} hours,
          which is the deadline that gets missed, because it runs while somebody
          is teaching.
        </p>
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${overdue.length} not acknowledged in time`}
            description="Past the two hours and still not acknowledged. Acknowledging late is better than not at all, and the record will show both."
          >
            <ul className="space-y-2 text-sm">
              {overdue.map((appeal) => (
                <li
                  key={appeal.id}
                  className="flex flex-wrap items-baseline gap-x-3"
                >
                  <Link
                    href={`/appeals/${appeal.id}`}
                    className="font-medium hover:underline"
                  >
                    {appeal.learnerName}
                  </Link>
                  <span className="text-[var(--muted)]">
                    {appeal.cohortName} · {GROUND_LABEL[appeal.ground]}
                  </span>
                  <span className="text-[var(--danger)]">
                    {overdueFor(appeal.clock.overdueBySeconds)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card
        title="Open"
        description="Everything lodged and not yet closed, newest first."
      >
        {rest.length === 0 && overdue.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Nothing open. An appeal is lodged from a learner&rsquo;s own page.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-3">Learner</th>
                  <th className="pb-2 pr-3">Cohort</th>
                  <th className="pb-2 pr-3">Ground</th>
                  <th className="pb-2 pr-3">Lodged</th>
                  <th className="pb-2 pr-3">Acknowledged</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...overdue, ...rest].map((appeal) => (
                  <tr
                    key={appeal.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="py-2 pr-3">
                      <Link
                        href={`/appeals/${appeal.id}`}
                        className="hover:underline"
                      >
                        {appeal.learnerName}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {appeal.cohortName}
                    </td>
                    <td className="py-2 pr-3">
                      {GROUND_LABEL[appeal.ground]}
                      {appeal.assessmentTitle ? (
                        <span className="block text-xs text-[var(--muted)]">
                          {appeal.assessmentTitle}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <ZonedTime
                        at={appeal.lodgedAt}
                        zone={tenant.timezone}
                        withDate
                        showViewer={false}
                      />
                      {appeal.lateAcceptanceReason ? (
                        <span className="block text-xs text-[var(--muted)]">
                          accepted out of time
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {appeal.acknowledgedAt ? (
                        <ZonedTime
                          at={appeal.acknowledgedAt}
                          zone={tenant.timezone}
                          showViewer={false}
                        />
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="py-2">{STATUS_LABEL[appeal.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
