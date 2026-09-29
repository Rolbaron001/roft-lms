import Link from "next/link";
import { notFound } from "next/navigation";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { Rich } from "@/components/rich-text";
import { IngestError, getIngestJob } from "@/lib/folder-import";
import type { IngestionPlan } from "@/lib/folder-plan";
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
  const t = await pageT();

  let job;
  try {
    job = await getIngestJob(session, id);
  } catch (error) {
    if (error instanceof IngestError) notFound();
    throw error;
  }

  const plan = job.proposal as IngestionPlan | null;

  const available = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: qualifications.id, title: qualifications.title })
      .from(qualifications)
      .orderBy(qualifications.title),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      {/*
        Back to the work, not back to a list of jobs.

        This said "← Back" and went to /imports. It sits at the very top of the
        page, which is where somebody reaches when they are heading for the
        menu bar - so Roland, having just committed 81 documents, clicked it on
        his way to the navigation and landed on a list of import jobs he had
        no use for. A vague label on an unhelpful destination, in the most
        clickable position on the screen.
      */}
      <Link
        href={
          job.qualificationId
            ? `/qualifications/${job.qualificationId}`
            : job.target?.qualificationId
              ? `/qualifications/${job.target.qualificationId}`
              : "/imports"
        }
        className="text-sm text-[var(--muted)] hover:underline"
      >
        {job.qualificationId || job.target?.qualificationId
          ? t("imports.backQualification")
          : t("imports.backFolders")}
      </Link>

      <h1 className="mt-2 font-mono text-lg font-semibold break-all">
        {job.sourcePath}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        <Rich
          text={t("imports.readAt", { count: job.files.length })}
          parts={{ time: <ZonedTime at={job.requestedAt} zone={tenant.timezone} withDate /> }}
        />
      </p>

      <div className="mt-6">
        <Card title={t("imports.contents")} description={t("imports.contentsNote")}>
          <ul className="space-y-1 text-sm">
            {job.files.map((file) => (
              <li key={file.name} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-xs">{file.name}</span>
                <span className="text-[var(--muted)]">
                  {t("imports.kb", { size: Math.max(1, Math.round(file.bytes / 1024)) })}
                </span>
                <span
                  className={
                    file.kind === "text" || file.kind === "convert"
                      ? "text-[var(--muted)]"
                      : "text-[var(--danger)]"
                  }
                >
                  {file.kind === "text"
                    ? t("imports.file.read")
                    : file.kind === "convert"
                      ? t("imports.file.converted")
                      : t("imports.file.notRead")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {job.error ? (
        <div className="mt-6">
          <Card title={t("imports.failed")} description="">
            <p className="text-sm">{job.error}</p>
          </Card>
        </div>
      ) : null}

      {plan ? (
        <div className="mt-6">
          <Card title={t("imports.proposes")} description={t("imports.proposesNote")}>
            <Proposal
              jobId={job.id}
              status={job.status}
              plan={plan}
              qualifications={available}
              target={job.target}
            />
          </Card>
        </div>
      ) : null}

    </AppShell>
  );
}
