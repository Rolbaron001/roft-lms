import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePermission, requireTenant } from "@/lib/request";
import { withTenant } from "@/db/client";
import { assessmentCriteria, assessments } from "@/db/schema";
import { CaptureError, getCaptureJob } from "@/lib/capture";
import { AppShell, Card } from "@/components/app-shell";
import { ReviewForm } from "./review-form";

/**
 * Reviewing what was read out of an uploaded document.
 *
 * The whole pipeline exists to arrive here. Nothing the parser produced is an
 * assessment until somebody on this page says it is.
 */
export default async function ReviewCapturePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:author");

  let job;
  try {
    job = await getCaptureJob(session, id);
  } catch (error) {
    if (error instanceof CaptureError) notFound();
    throw error;
  }

  const [available, criteria] = await Promise.all([
    withTenant(session.organisationId, (tx) =>
      tx
        .select({
          id: assessments.id,
          title: assessments.title,
          purpose: assessments.purpose,
        })
        .from(assessments)
        .where(eq(assessments.status, "draft")),
    ),
    withTenant(session.organisationId, (tx) =>
      tx
        .select({ id: assessmentCriteria.id, code: assessmentCriteria.code })
        .from(assessmentCriteria),
    ),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/capture" className="text-sm text-[var(--muted)] hover:underline">
          ← Uploads
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{job.paperFilename}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {job.guideFilename
            ? `Read with ${job.guideFilename}.`
            : "No answer guide was uploaded."}{" "}
          The original is kept and hashed, so a question in dispute is settled
          against the document rather than against this reading of it.
        </p>
      </div>

      {job.committedAt ? (
        <Card>
          <p className="text-sm">
            This was committed on{" "}
            {job.committedAt.toLocaleDateString("en-ZA", { dateStyle: "long" })}.
            An upload is committed once; upload the document again to make
            another paper from it.
          </p>
        </Card>
      ) : (
        <ReviewForm
          jobId={job.id}
          proposal={job.proposal}
          classified={job.classified}
          assessments={available}
          criteria={criteria}
        />
      )}
    </AppShell>
  );
}
