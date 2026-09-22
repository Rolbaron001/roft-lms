import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePermission, requireTenant } from "@/lib/request";
import { withTenant } from "@/db/client";
import { assessmentCriteria, assessments } from "@/db/schema";
import {
  CaptureError,
  captureOrigin,
  getCaptureJob,
  wayBackFrom,
} from "@/lib/capture";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ assessment?: string }>;
}) {
  const { id } = await params;
  /*
   * Which assessment this paper was captured for, where it was captured from a
   * qualification rather than uploaded on its own.
   *
   * A suggestion for this screen and nothing more. The reviewer may choose a
   * different one, and nothing is committed until they do.
   */
  const suggested = (await searchParams).assessment ?? null;
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:author");

  let job;
  try {
    job = await getCaptureJob(session, id);
  } catch (error) {
    if (error instanceof CaptureError) notFound();
    throw error;
  }

  /*
   * A committed job has nothing left to review, and the paper it became is
   * what anybody arriving here actually wants.
   *
   * Roland, 22 September: the button on a committed upload "serves no purpose.
   * It doesn't open the document, nor does it actually show a preview screen
   * (of what a student would see)". There is such a screen, and this job knows
   * which paper it is, so the dead end goes to it instead of describing
   * itself.
   */
  if (job.committedAt && job.paperId) {
    redirect(`/papers/${job.paperId}/preview`);
  }

  const [origin, available, criteria] = await Promise.all([
    captureOrigin(session, { jobId: id }),
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

  const back = wayBackFrom(origin);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={back.href}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← {back.label}
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
        suggestedAssessmentId={suggested}
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
