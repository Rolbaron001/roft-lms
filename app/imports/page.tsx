import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listIngestJobs } from "@/lib/folder-import";
import { extensionState } from "@/lib/extensions";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { ZonedTime } from "@/components/zoned-time";

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
  const jobs = await listIngestJobs(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">What the AI has read</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Every folder that has been read, and what became of it. Reading a new
          one starts where the work is — on the qualification, course or
          material you are building — rather than here.
        </p>
      </div>

      {!extension.registered ? (
        <Card
          title="You have not set up an AI extension"
          description="It is optional and yours rather than the tenant's — every member of staff sets up their own, with their own subscription."
        >
          <Link href="/settings" className="text-sm underline">
            Switch one on
          </Link>
        </Card>
      ) : null}

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
                    href={`/imports/${job.id}`}
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
