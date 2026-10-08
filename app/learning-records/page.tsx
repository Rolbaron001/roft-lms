import { AppShell, Card } from "@/components/app-shell";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { externalRecordCounts } from "@/lib/xapi";
import { ImportForm } from "./import-form";
import { StoreForm } from "./store-form";
import { recordStoreFor } from "@/lib/record-store";

/**
 * Moving learning records to and from another system. Job sheet A10.
 */
export default async function LearningRecordsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("records:manage");
  const { t, when: written } = await pageLocale();
  const counts = await externalRecordCounts(session);
  const store = await recordStoreFor(session);
  const when = (at: Date) => written(at, { short: true });

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("lrs.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("lrs.intro")}</p>
      </div>

      <div className="space-y-6">
        <Card title={t("lrs.out")} description={t("lrs.outNote")}>
          <a
            href="/api/xapi/export"
            className="inline-block rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            {t("lrs.download")}
          </a>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("lrs.downloadNote")}</p>
        </Card>

        <Card title={t("lrs.store")} description={t("lrs.storeNote")}>
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

        <Card title={t("lrs.in")} description={t("lrs.inNote")}>
          <ImportForm />
          {counts.total > 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              {counts.unattached > 0
                ? t("lrs.heldUnmatched", { count: counts.total, unmatched: counts.unattached })
                : t("lrs.held", { count: counts.total })}
            </p>
          ) : null}
        </Card>
      </div>
    </AppShell>
  );
}
