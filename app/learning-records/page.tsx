import { AppShell, Card } from "@/components/app-shell";
import { requirePermission, requireTenant } from "@/lib/request";
import { externalRecordCounts } from "@/lib/xapi";
import { ImportForm } from "./import-form";
import { StoreForm } from "./store-form";
import { recordStoreFor } from "@/lib/record-store";
import { DEFAULT_TIME_ZONE } from "@/lib/timezone";

/**
 * Moving learning records to and from another system. Job sheet A10.
 */
export default async function LearningRecordsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("records:manage");
  const counts = await externalRecordCounts(session);
  const store = await recordStoreFor(session);
  const when = (at: Date) =>
    at.toLocaleString("en-ZA", { timeZone: DEFAULT_TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

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
          description="Every enrolment, lesson completed, assessment attempted, competent or not yet competent decision, course completed, statement of results, certificate, and qualification certificate received, one statement each. Each keeps the same identity every time you export, so loading two exports into another system does not double anybody's history."
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
          title="Send records to your own learning record store"
          description="If you keep a learning record store, connect it here and every record above goes to it within the hour of happening, the ones already made first. Each is sent once; a statement the store already holds is left as it is. The store's secret is sealed on this platform, never shown again, and forgotten when you disconnect."
        >
          {/* Keyed on the connection, so connecting or disconnecting starts
              the form afresh rather than leaving the last message showing. */}
          <StoreForm
            key={store ? `${store.endpoint}:${store.username}` : "none"}
            store={
              store
                ? {
                    ...store,
                    lastAttemptAt: store.lastAttemptAt ? when(store.lastAttemptAt) : null,
                    lastSuccessAt: store.lastSuccessAt ? when(store.lastSuccessAt) : null,
                  }
                : null
            }
          />
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
