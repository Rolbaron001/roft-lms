import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listCaptureJobs, namingConventionFor } from "@/lib/capture";
import { listProgrammeReadiness } from "@/lib/programme-readiness";
import { EmptyState } from "@/components/empty-state";
import { AppShell } from "@/components/app-shell";
import { UploadForm } from "./upload-form";

export default async function CapturePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:author");
  const [jobs, programmes, convention] = await Promise.all([
    listCaptureJobs(session),
    listProgrammeReadiness(session),
    namingConventionFor(session),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Capture a paper</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Choose the qualification, then upload a workbook or an assessment
          with its answer guide. The App reads what it can, shows you what it
          made of it and what it could not work out, and waits. Nothing becomes
          an assessment until you confirm it.
        </p>
      </div>

      {/* The house rule, shown where the file is chosen rather than buried in
          settings. A filename the App can read saves whoever uploads it from
          retyping what the document already says. */}
      <div className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          How to name the file
        </p>
        <p className="mt-1 font-mono text-sm">{convention.pattern}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {Object.entries(convention.artefactCodes)
            .map(([code, meaning]) => `${code} = ${meaning.replace(/_/g, " ")}`)
            .join(" · ")}
          {" · "}
          {convention.memorandumMarker} marks an answer guide.
        </p>
        {session.permissions.includes("tenant:manage_settings") ? (
          <Link
            href="/settings"
            className="mt-2 inline-block text-xs underline underline-offset-2"
          >
            Change how filenames are read
          </Link>
        ) : null}
      </div>

      <UploadForm programmes={programmes} />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Uploaded
        </h2>
        {jobs.length === 0 ? (
          <EmptyState title="Nothing uploaded yet">
            Choose a qualification above and upload a workbook with its answer
            guide. What the App reads is shown to you before any of it becomes
            an assessment.
          </EmptyState>
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
