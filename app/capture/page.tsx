import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listCaptureJobs } from "@/lib/capture";
import { AppShell, Card } from "@/components/app-shell";
import { UploadForm } from "./upload-form";

export default async function CapturePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:author");
  const jobs = await listCaptureJobs(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Capture a paper</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Upload a workbook or an assessment with its answer guide. The App
          reads what it can, shows you what it made of it and what it could not
          work out, and waits. Nothing becomes an assessment until you confirm
          it.
        </p>
      </div>

      <UploadForm />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Uploaded
        </h2>
        {jobs.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--muted)]">Nothing uploaded yet.</p>
          </Card>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
              >
                <span className="text-sm">
                  <span className="font-medium">{job.paperFilename}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {job.committedAt
                      ? "Committed"
                      : `${(job.problems ?? []).length} outstanding`}
                  </span>
                </span>
                <Link
                  href={`/capture/${job.id}`}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
                >
                  {job.committedAt ? "View" : "Review"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
