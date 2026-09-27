import Link from "next/link";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import {
  HOURS_TO_ACKNOWLEDGE,
  acknowledgementDue,
  openAppeals,
} from "@/lib/appeals";
import type { Translate } from "@/lib/i18n";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { ZonedTime } from "@/components/zoned-time";

function overdueFor(seconds: number, t: Translate): string {
  const hours = Math.floor(seconds / 3600);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return days === 1 ? t("appeals.dayOver") : t("appeals.daysOver", { count: days });
  }
  if (hours >= 1) return hours === 1 ? t("appeals.hourOver") : t("appeals.hoursOver", { count: hours });
  return t("appeals.minutesOver", { count: Math.floor(seconds / 60) });
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
  const t = await pageT();
  const ground = (value: string) => maybe(t, `appeals.ground.${value}`) ?? value;

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
        <h1 className="text-xl font-semibold">{t("appeals.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("appeals.intro", { hours: HOURS_TO_ACKNOWLEDGE })}
        </p>
      </div>

      {overdue.length > 0 ? (
        <div className="mb-6">
          <Card
            title={t("appeals.late", { count: overdue.length })}
            description={t("appeals.lateIntro", { hours: HOURS_TO_ACKNOWLEDGE })}
          >
            <ul className="space-y-2 text-sm">
              {overdue.map((appeal) => (
                <li key={appeal.id} className="flex flex-wrap items-baseline gap-x-3">
                  <Link href={`/appeals/${appeal.id}`} className="font-medium hover:underline">
                    {appeal.learnerName}
                  </Link>
                  <span className="text-[var(--muted)]">
                    {appeal.cohortName} · {ground(appeal.ground)}
                  </span>
                  <span className="text-[var(--danger)]">
                    {overdueFor(appeal.clock.overdueBySeconds, t)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card title={t("appeals.open")} description={t("appeals.openIntro")}>
        {rest.length === 0 && overdue.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("appeals.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-3">{t("appeals.learner")}</th>
                  <th className="pb-2 pr-3">{t("appeals.cohort")}</th>
                  <th className="pb-2 pr-3">{t("appeals.ground")}</th>
                  <th className="pb-2 pr-3">{t("appeals.lodged")}</th>
                  <th className="pb-2 pr-3">{t("appeals.acknowledged")}</th>
                  <th className="pb-2">{t("appeals.status")}</th>
                </tr>
              </thead>
              <tbody>
                {[...overdue, ...rest].map((appeal) => (
                  <tr key={appeal.id} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-3">
                      <Link href={`/appeals/${appeal.id}`} className="hover:underline">
                        {appeal.learnerName}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted)]">{appeal.cohortName}</td>
                    <td className="py-2 pr-3">
                      {ground(appeal.ground)}
                      {appeal.assessmentTitle ? (
                        <span className="block text-xs text-[var(--muted)]">
                          {appeal.assessmentTitle}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <ZonedTime at={appeal.lodgedAt} zone={tenant.timezone} withDate showViewer={false} />
                      {appeal.lateAcceptanceReason ? (
                        <span className="block text-xs text-[var(--muted)]">{t("appeals.outOfTime")}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {appeal.acknowledgedAt ? (
                        <ZonedTime at={appeal.acknowledgedAt} zone={tenant.timezone} showViewer={false} />
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="py-2">{maybe(t, `appeals.status.${appeal.status}`) ?? appeal.status}</td>
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
