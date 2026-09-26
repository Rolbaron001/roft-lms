import { AppShell, Card } from "@/components/app-shell";
import { requirePermission, requireTenant } from "@/lib/request";
import { externalRecordCounts } from "@/lib/xapi";
import { ImportForm } from "./import-form";

/**
 * Moving learning records to and from another system. Job sheet A10.
 */
export default async function LearningRecordsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("records:manage");
  const counts = await externalRecordCounts(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Learning records</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Your learners&rsquo; records, in and out, as xAPI statements: the format learning record stores and most
          learning systems exchange. Nothing here changes a learner&rsquo;s results on this platform.
        </p>
      </div>

      <div className="space-y-6">
        <Card
          title="Take your records out"
          description="Every enrolment, lesson completed, assessment attempted, competent or not yet competent decision, course completed, statement of results and certificate, one statement each. Each keeps the same identity every time you export, so loading two exports into another system does not double anybody's history."
        >
          <a
            href="/api/xapi/export"
            className="inline-block rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Download all learning records
          </a>
          <p className="mt-2 text-xs text-[var(--muted)]">
            The file names every learner and their email address. Keep it as you would any record of personal
            information.
          </p>
        </Card>

        <Card
          title="Bring records in"
          description="A file of xAPI statements from another system: a list of statements, or what a learning record store returns. Each is matched to a learner here by email and shown on their record. It is kept as learning done elsewhere, not turned into an enrolment or a result here, because none of it was taught or assessed on this platform."
        >
          <ImportForm />
          {counts.total > 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              {counts.total} statements held from elsewhere
              {counts.unattached > 0 ? `, ${counts.unattached} not yet matched to a learner` : ""}.
            </p>
          ) : null}
        </Card>
      </div>
    </AppShell>
  );
}
