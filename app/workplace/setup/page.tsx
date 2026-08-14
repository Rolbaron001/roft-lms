import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { workplaceSetupData } from "@/lib/workplace";
import { AppShell, Card } from "@/components/app-shell";
import { AgreementForm, LogbookForm } from "./setup-forms";

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Setting up work experience: who is placed where, under whom, and which
 * modules they are working through.
 *
 * Staff only. The coach's own view is /workplace, which shows their learners
 * and nothing else.
 */
export default async function WorkplaceSetupPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("workplace:manage");
  const { learners, coaches, modules, agreements } =
    await workplaceSetupData(session);

  const untranscribed = modules.filter((entry) => entry.elementCount === 0);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/workplace"
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          ← All work experience
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Set up work experience</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          A learner does work experience at an employer, supervised by somebody
          that employer provides. The agreement records who that is; the logbook
          records what the curriculum requires them to do.
        </p>
      </div>

      {untranscribed.length > 0 ? (
        <div
          className="mb-6 rounded-lg border-2 p-4"
          style={{ borderColor: "var(--danger)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
            {untranscribed.length} work experience{" "}
            {untranscribed.length === 1 ? "module has" : "modules have"} no
            requirements captured.
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {untranscribed.map((entry) => entry.code).join(", ")}. A logbook
            built from an empty module would attest to nothing, so those cannot
            be opened until the curriculum&rsquo;s work activities, workplace
            knowledge and supporting evidence have been imported.
          </p>
        </div>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">1. The workplace agreement</h2>
        <Card>
          <AgreementForm learners={learners} coaches={coaches} />
        </Card>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">2. Open a logbook</h2>
        <Card>
          <LogbookForm agreements={agreements} modules={modules} />
        </Card>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Agreements in place</h2>
        {agreements.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--muted)]">None yet.</p>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Learner</th>
                  <th className="px-4 py-3 font-medium">Employer</th>
                  <th className="px-4 py-3 font-medium">Coach</th>
                  <th className="px-4 py-3 font-medium">Dates</th>
                  <th className="px-4 py-3 font-medium">Logbooks</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((agreement) => (
                  <tr
                    key={agreement.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      {agreement.learnerFirst} {agreement.learnerLast}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {agreement.employerName}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {agreement.coachName}
                      {agreement.coachDesignation
                        ? ` · ${agreement.coachDesignation}`
                        : ""}
                      <p className="text-xs">{agreement.coachEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {formatDate(agreement.startDate)} –{" "}
                      {formatDate(agreement.endDate)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[var(--muted)]">
                      {agreement.moduleIdsOpen.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
