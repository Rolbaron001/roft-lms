import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { getEnrolmentForDelivery, EnrolmentError } from "@/lib/enrolment";
import {
  closeExpiredAttempt,
  getSitting,
  PaperError,
  startAttempt,
} from "@/lib/papers";
import { AppShell, Card } from "@/components/app-shell";
import { PaperForm } from "./paper-form";

/**
 * Sitting a paper.
 *
 * Opening the page opens the attempt — or resumes the one already in progress,
 * which is what a learner coming back the next morning expects. The gate is
 * checked inside `startAttempt`, so arriving here by typing the address is
 * refused exactly as clicking a locked step would be.
 */
export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { id, assessmentId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  let delivery;
  try {
    delivery = await getEnrolmentForDelivery(session, id);
  } catch (error) {
    if (error instanceof EnrolmentError) notFound();
    throw error;
  }

  let sitting;
  let refusal: string | null = null;

  try {
    sitting = await startAttempt(session, assessmentId, { enrolmentId: id });
  } catch (error) {
    if (error instanceof PaperError) {
      refusal = error.message;
    } else {
      throw error;
    }
  }

  // An attempt whose clock ran out while the learner was away is handed in with
  // whatever was saved, rather than left open or thrown away. The comparison
  // happens inside `closeExpiredAttempt`, against the server clock — this page
  // must not decide it from the render-time clock, which is neither the
  // authority nor stable across a re-render.
  if (sitting?.closesAt) {
    const closed = await closeExpiredAttempt(session, sitting.submissionId);
    if (closed) sitting = await getSitting(session, sitting.submissionId);
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/learn/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← {delivery.course.title}
        </Link>

        {sitting ? (
          <>
            <h1 className="mt-2 text-xl font-semibold">
              {sitting.assessmentTitle}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {sitting.purpose === "summative"
                ? "This is assessed and counts towards your qualification."
                : "This is preparation. It is marked and returned to you, and it does not decide anything."}{" "}
              {sitting.totalMarks} marks
              {sitting.attemptNumber > 1
                ? ` · attempt ${sitting.attemptNumber}`
                : ""}
            </p>
          </>
        ) : (
          <h1 className="mt-2 text-xl font-semibold">Not open</h1>
        )}
      </div>

      {refusal ? (
        <Card>
          <p className="text-sm">{refusal}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Go back to the course to see what is still outstanding.
          </p>
        </Card>
      ) : sitting ? (
        <PaperForm sitting={sitting} enrolmentId={id} />
      ) : null}
    </AppShell>
  );
}
