import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listImportJobs } from "@/lib/ai-import";
import { extensionState } from "@/lib/extensions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { ZonedTime } from "@/components/zoned-time";
import { FolderReader } from "./reader";

const STATUS_LABEL: Record<string, string> = {
  reading: "Reading",
  proposed: "Waiting to be checked",
  failed: "Failed",
  committed: "Committed",
  discarded: "Discarded",
};

/**
 * Building a qualification from a folder of documents.
 *
 * The model reads and proposes; a person commits, one module at a time,
 * through the same authoring functions the hand editor uses. Nothing here
 * writes a qualification on its own, and that is the design rather than a
 * limitation: a curriculum nobody has checked against the document it came
 * from is exactly what this platform exists to prevent.
 */
export default async function AiImportPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");

  const extension = await extensionState(session);
  const jobs = await listImportJobs(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Build from documents</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Point the extension at a folder and it reads what is in it and
          proposes the qualification those documents describe. It proposes only:
          you commit it a module at a time, and every check that applies to a
          hand-built curriculum applies to this one.
        </p>
      </div>

      {!extension.enabled ? (
        <Card
          title="You have not switched on an AI extension"
          description="It is optional, off by default, and yours rather than the tenant's — every member of staff has their own."
        >
          <Link href="/account" className="text-sm underline">
            Switch one on
          </Link>
        </Card>
      ) : extension.availability && !extension.availability.available ? (
        <Card
          title="The extension is switched on but cannot run here"
          description={extension.availability.reason}
        >
          <p className="text-sm text-[var(--muted)]">
            {extension.availability.remedy}
          </p>
        </Card>
      ) : (
        <Card
          title="Read a folder"
          description="PDFs, Word documents and plain text. PDFs and Word files are converted with the same extractor the rest of the platform uses, so the model reads what Capture would read."
        >
          <FolderReader roots={extension.allowedImportRoots} />
        </Card>
      )}

      {jobs.length > 0 ? (
        <div className="mt-6">
          <Card
            title="What has been read"
            description="Kept whether committed or discarded. What the extension proposed and was rejected is how anybody judges whether it is worth having."
          >
            <ul className="space-y-2 text-sm">
              {jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-baseline gap-x-3">
                  <Link
                    href={`/ai-import/${job.id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {job.sourcePath}
                  </Link>
                  <span className="text-[var(--muted)]">
                    <ZonedTime
                      at={job.requestedAt}
                      zone={tenant.timezone}
                      withDate
                      showViewer={false}
                    />
                  </span>
                  <span>{STATUS_LABEL[job.status] ?? job.status}</span>
                  {job.error ? (
                    <span className="text-[var(--danger)]">{job.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
