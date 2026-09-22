import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listCaptureJobs, namingConventionFor } from "@/lib/capture";
import { dateInZone } from "@/lib/timezone";
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
          The App reads what it can, shows you what it made of it and what it
          could not work out, and waits. Nothing becomes an assessment until
          you confirm it.
        </p>

        {/*
          Said here because this screen never mentioned it.

          Roland, 21 September: "This process needs a link to the qualification
          upload ... The workbooks and assessments are in the folder, they have
          been read and linked. Why can't they just be captured?"

          They can, and the shorter route is the one a provider who imported a
          folder should take: the files are already held, so uploading them a
          second time is work this screen was inventing. The form below stays
          for a paper that never came in with a folder.
        */}
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          If the workbook came in with a folder, it is already here:{" "}
          <Link
            href="/qualifications"
            className="underline underline-offset-2"
          >
            open the qualification
          </Link>{" "}
          and capture it from what is filed &mdash; no second upload, and the
          answer guide is paired for you. Use the form below only for a paper
          the platform does not already hold.
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
          <EmptyState title="Nothing captured yet">
            Open a qualification and capture the workbooks already filed
            against it, or upload one above. What the App reads is shown to you
            before any of it becomes an assessment.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
              >
                {/*
                  What happened to it, said here rather than on a screen of
                  its own.

                  Roland, 22 September: the button on a committed upload
                  "serves no purpose ... It gives a message which is
                  meaningless, and could rather be displayed in the box under
                  the file name." The message was the whole of that screen, so
                  it belongs in the line it describes.
                */}
                <span className="text-sm">
                  <span className="font-medium">{job.paperFilename}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {job.committedAt
                      ? `Committed on ${dateInZone(job.committedAt, tenant.timezone)}. An upload is committed once; upload the document again to make another paper from it.`
                      : `${(job.problems ?? []).length} outstanding`}
                  </span>
                </span>
                {/*
                  And the button offers the paper rather than the job that
                  made it. A committed upload with no paper has nothing to
                  show, so it is given no button at all instead of one that
                  leads to a message already printed above.
                */}
                {job.committedAt ? (
                  job.paperId ? (
                    <Link
                      href={`/papers/${job.paperId}/preview`}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
                    >
                      Preview
                    </Link>
                  ) : null
                ) : (
                  <Link
                    href={`/capture/${job.id}`}
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
                  >
                    Review
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
