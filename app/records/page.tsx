import Link from "next/link";
import { pageT, requireSession, requireTenant } from "@/lib/request";
import { maybe } from "@/lib/i18n";
import {
  disposalRegister,
  expiringDocuments,
  library,
  retentionDue,
} from "@/lib/records";
import { dateInZone } from "@/lib/timezone";
import { addWorkingDays } from "@/lib/working-days";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { CATEGORY_LABEL, DisposalForm, FileDocument } from "./forms";

/**
 * The document library, and what has reached the end of its retention period.
 *
 * The part of the platform that lets it be the system of record rather than a
 * working copy of one: a place for the accreditation letter, the policies and
 * the contracts, and a register of what was done with anything past its date.
 */
export default async function RecordsPage() {
  const tenant = await requireTenant();
  const session = await requireSession();
  const t = await pageT();

  const canManage = session.permissions.includes("records:manage");
  const canReadAll = session.permissions.includes("records:read");
  const today = dateInZone(new Date(), tenant.timezone);
  // Sixty working days is about a quarter, which is long enough to renew a tax
  // clearance and short enough that the list is not permanently full.
  const horizon = addWorkingDays(today, 60);

  const documents = await library(session);
  const [expiring, due, register] = canReadAll
    ? await Promise.all([
        expiringDocuments(session, today, horizon),
        canManage ? retentionDue(session, today) : Promise.resolve([]),
        disposalRegister(session),
      ])
    : [[], [], []];

  const byCategory = new Map<string, typeof documents>();
  for (const document of documents) {
    const list = byCategory.get(document.category) ?? [];
    list.push(document);
    byCategory.set(document.category, list);
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("records.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("records.intro")}
          {canManage ? ` ${t("records.introManage")}` : ""}
        </p>
      </div>

      {expiring.length > 0 ? (
        <div className="mb-6">
          <Card title={t("records.expiring", { count: expiring.length })} description={t("records.expiringNote")}>
            <ul className="space-y-1 text-sm">
              {expiring.map((row) => (
                <li key={row.id}>
                  <span className="font-medium">{row.title}</span>
                  <span
                    className={
                      row.expiresOn && row.expiresOn < today
                        ? "ml-2 text-[var(--danger)]"
                        : "ml-2 text-[var(--muted)]"
                    }
                  >
                    {row.expiresOn && row.expiresOn < today
                      ? t("records.expired", { date: row.expiresOn })
                      : t("records.expires", { date: row.expiresOn ?? "" })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card title={t("records.library")} description={t("records.libraryNote")}>
        {documents.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {t("records.nothing")}
            {canManage ? ` ${t("records.nothingManage")}` : ""}
          </p>
        ) : (
          <div className="space-y-5">
            {[...byCategory.entries()].map(([category, rows]) => (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {maybe(t, `records.category.${category}`) ?? CATEGORY_LABEL[category] ?? category}
                </h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap gap-x-3">
                      {/*
                        Openable, which it was not.

                        The library listed every document by name and offered
                        no way to read one, so a learner guide filed for
                        learners was a title they could look at. The route
                        applies the same rule as this list.
                      */}
                      <a
                        href={`/api/library/${row.id}`}
                        className="font-medium underline underline-offset-2"
                      >
                        {row.title}
                      </a>
                      {row.version ? (
                        <span className="text-[var(--muted)]">
                          {row.version}
                        </span>
                      ) : null}
                      {row.status !== "current" ? (
                        <span className="text-[var(--muted)]">
                          {maybe(t, `records.status.${row.status}`) ?? row.status}
                        </span>
                      ) : null}
                      {row.effectiveFrom ? (
                        <span className="text-[var(--muted)]">
                          {t("records.from", { date: row.effectiveFrom })}
                        </span>
                      ) : null}
                      {row.category === "learner_guide" ? (
                        <span className="text-[var(--muted)]">{t("records.forLearners")}</span>
                      ) : row.visibleToAll ? (
                        <span className="text-[var(--muted)]">{t("records.everybody")}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {canManage ? (
          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <FileDocument
              current={documents
                .filter((row) => row.status === "current")
                .map((row) => ({
                  id: row.id,
                  title: row.title,
                  version: row.version,
                }))}
            />
          </div>
        ) : null}
      </Card>

      {canManage && due.length > 0 ? (
        <div className="mt-6">
          <Card title={t("records.retention", { count: due.length })} description={t("records.retentionNote")}>
            <ul className="space-y-4 text-sm">
              {due.map((row) => (
                <li key={row.userId}>
                  <p>
                    <Link
                      href={`/people/${row.userId}`}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="ml-2 text-[var(--muted)]">
                      {t("records.certified", { certified: row.certifiedOn, due: row.dueOn })}
                    </span>
                  </p>
                  <DisposalForm
                    learnerId={row.userId}
                    name={row.name}
                    dueOn={row.dueOn}
                  />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {canReadAll && register.length > 0 ? (
        <div className="mt-6">
          <Card title={t("records.register")} description={t("records.registerNote")}>
            <ul className="space-y-1 text-sm">
              {register.map((row) => (
                <li key={row.id} className="flex flex-wrap gap-x-3">
                  <span className="font-medium">{maybe(t, `records.decision.${row.status}`) ?? row.status}</span>
                  <span className="text-[var(--muted)]">
                    {maybe(t, `records.subject.${row.subject}`) ?? row.subject} ·{" "}
                    {t("records.due", { date: row.dueOn })}
                  </span>
                  {row.firstName ? (
                    <span className="text-[var(--muted)]">
                      {t("records.by", { name: `${row.firstName} ${row.lastName}` })}
                    </span>
                  ) : null}
                  {row.reason ? <span>{row.reason}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
