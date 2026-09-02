import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
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

const SUBJECT_LABEL: Record<string, string> = {
  learner_documents: "Learner documents",
  assessment_evidence: "Assessment evidence",
  library_document: "Library document",
};

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
        <h1 className="text-xl font-semibold">Records</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Policies, accreditation letters, contracts and statutory documents -
          everything the provider holds that does not belong to one learner.
          {canManage
            ? " And what has reached the end of its retention period."
            : ""}
        </p>
      </div>

      {expiring.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${expiring.length} expiring`}
            description="An expired tax clearance is the kind of thing nobody notices until the week it is needed."
          >
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
                      ? `expired ${row.expiresOn}`
                      : `expires ${row.expiresOn}`}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card
        title="The library"
        description="Superseded versions are kept, because the policy that governed in March is the one an audit of March asks about."
      >
        {documents.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Nothing filed yet.
            {canManage
              ? " The accreditation letter is the one worth putting in first."
              : ""}
          </p>
        ) : (
          <div className="space-y-5">
            {[...byCategory.entries()].map(([category, rows]) => (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {CATEGORY_LABEL[category] ?? category}
                </h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap gap-x-3">
                      <span className="font-medium">{row.title}</span>
                      {row.version ? (
                        <span className="text-[var(--muted)]">
                          {row.version}
                        </span>
                      ) : null}
                      {row.status !== "current" ? (
                        <span className="text-[var(--muted)]">
                          {row.status}
                        </span>
                      ) : null}
                      {row.effectiveFrom ? (
                        <span className="text-[var(--muted)]">
                          from {row.effectiveFrom}
                        </span>
                      ) : null}
                      {row.visibleToAll ? (
                        <span className="text-[var(--muted)]">
                          everybody can read this
                        </span>
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
          <Card
            title={`${due.length} past the retention period`}
            description="Counted from the certification date, over the retention period on this tenant. Nothing here has been archived or destroyed: the platform says what is due and a person decides."
          >
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
                      certified {row.certifiedOn} · due {row.dueOn}
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
          <Card
            title="Disposal register"
            description="Everything decided about a record past its date, with who decided it. A record that quietly disappeared is worse than one kept too long."
          >
            <ul className="space-y-1 text-sm">
              {register.map((row) => (
                <li key={row.id} className="flex flex-wrap gap-x-3">
                  <span className="font-medium capitalize">{row.status}</span>
                  <span className="text-[var(--muted)]">
                    {SUBJECT_LABEL[row.subject] ?? row.subject} · due {row.dueOn}
                  </span>
                  {row.firstName ? (
                    <span className="text-[var(--muted)]">
                      by {row.firstName} {row.lastName}
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
