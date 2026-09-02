import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  registrationDue,
  upcomingSittings,
} from "@/lib/eisa-registration";
import { dateInZone } from "@/lib/timezone";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { SittingForm } from "./sitting-form";

/**
 * The external assessment calendar, and who has to be registered by when.
 *
 * The dates arrive in an email from the assessment quality partner and
 * registration closes about three months ahead of a sitting. That gap is the
 * failure: a cohort finishing in November is entered for a sitting whose
 * deadline passed in August, and nobody notices until it has.
 */
export default async function EisaPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  const today = dateInZone(new Date(), tenant.timezone);
  const [sittings, due] = await Promise.all([
    upcomingSittings(session, today),
    registrationDue(session, today),
  ]);

  const urgent = due.filter((row) => row.urgent);
  const canManage = session.permissions.includes("enrolment:manage");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">External assessment</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          When each sitting is, when registration for it closes, and which
          cohorts still have to be entered. Registration typically closes about
          three months ahead, which is why a cohort finishing later in the year
          has to be entered long before it finishes.
        </p>
      </div>

      {urgent.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${urgent.length} to register now`}
            description="Registration closes within ten working days and these cohorts have no registration date recorded."
          >
            <ul className="space-y-1 text-sm">
              {urgent.map((row) => (
                <li key={`${row.sittingId}:${row.cohortId}`}>
                  <Link
                    href={`/eisa/${row.cohortId}?sitting=${row.sittingId}`}
                    className="font-medium hover:underline"
                  >
                    {row.cohortName}
                  </Link>
                  <span className="ml-2 text-[var(--danger)]">
                    closes {row.registrationCloses}
                  </span>
                  <span className="ml-2 text-[var(--muted)]">
                    for {row.sittingName}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card
        title="Sittings"
        description="Only those still open for registration. A closed one is nothing anybody can act on, and leaving it here would push the next real deadline down the page."
      >
        {sittings.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No sittings recorded. Add the dates from the assessment quality
            partner&rsquo;s letter and the countdown starts.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-3">Sitting</th>
                  <th className="pb-2 pr-3">Qualification</th>
                  <th className="pb-2 pr-3">Registration closes</th>
                  <th className="pb-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {sittings.map((sitting) => (
                  <tr
                    key={sitting.id}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="py-2 pr-3">
                      {sitting.name}
                      {sitting.assessmentQualityPartner ? (
                        <span className="block text-xs text-[var(--muted)]">
                          {sitting.assessmentQualityPartner}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {sitting.qualificationTitle ?? "All"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {sitting.registrationCloses}
                    </td>
                    <td className="py-2 tabular-nums">{sitting.sittingDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage ? (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <SittingForm />
          </div>
        ) : null}
      </Card>

      {due.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Cohorts still to be entered"
            description="Everything with an open deadline and no registration date recorded against it."
          >
            <ul className="space-y-1 text-sm">
              {due.map((row) => (
                <li key={`${row.sittingId}:${row.cohortId}`}>
                  <Link
                    href={`/eisa/${row.cohortId}?sitting=${row.sittingId}`}
                    className="hover:underline"
                  >
                    {row.cohortName}
                  </Link>
                  <span className="ml-2 text-[var(--muted)]">
                    {row.sittingName} · closes {row.registrationCloses}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
