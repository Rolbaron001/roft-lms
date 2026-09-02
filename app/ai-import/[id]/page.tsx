import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { ImportError, getImportJob, type ImportProposal } from "@/lib/ai-import";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { ZonedTime } from "@/components/zoned-time";
import { Proposal } from "./proposal";

export default async function ImportJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");

  let job;
  try {
    job = await getImportJob(session, id);
  } catch (error) {
    if (error instanceof ImportError) notFound();
    throw error;
  }

  const proposal = job.proposal as ImportProposal | null;

  const available = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: qualifications.id, title: qualifications.title })
      .from(qualifications)
      .orderBy(qualifications.title),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <Link
        href="/ai-import"
        className="text-sm text-[var(--muted)] hover:underline"
      >
        ← Back
      </Link>

      <h1 className="mt-2 font-mono text-lg font-semibold break-all">
        {job.sourcePath}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Read{" "}
        <ZonedTime at={job.requestedAt} zone={tenant.timezone} withDate /> ·{" "}
        {job.files.length} files
      </p>

      <div className="mt-6">
        <Card
          title="What was in the folder"
          description="Everything found, and what was done with it. PDFs and Word documents are converted with the same extractor the rest of the platform uses, so the model reads exactly what Capture would."
        >
          <ul className="space-y-1 text-sm">
            {job.files.map((file) => (
              <li key={file.name} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-xs">{file.name}</span>
                <span className="text-[var(--muted)]">
                  {Math.max(1, Math.round(file.bytes / 1024))} KB
                </span>
                <span
                  className={
                    file.kind === "text" || file.kind === "convert"
                      ? "text-[var(--muted)]"
                      : "text-[var(--danger)]"
                  }
                >
                  {file.kind === "text"
                    ? "read"
                    : file.kind === "convert"
                      ? "converted and read"
                      : "not read"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {job.error ? (
        <div className="mt-6">
          <Card title="It did not work" description="">
            <p className="text-sm">{job.error}</p>
          </Card>
        </div>
      ) : null}

      {proposal ? (
        <div className="mt-6">
          <Card
            title={proposal.title ?? "What it proposes"}
            description={
              proposal.saqaId
                ? `SAQA ${proposal.saqaId}${proposal.nqfLevel ? ` · NQF ${proposal.nqfLevel}` : ""}`
                : "The extension proposes; you commit, a module at a time."
            }
          >
            <Proposal
              jobId={job.id}
              status={job.status}
              modules={proposal.modules ?? []}
              qualifications={available}
              problems={job.problems}
              committed={job.committedModules ?? []}
            />
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
