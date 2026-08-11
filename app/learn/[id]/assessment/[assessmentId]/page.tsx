import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { AssessmentError, getAssessmentForLearner } from "@/lib/assessment";
import { EnrolmentError, getEnrolmentForDelivery } from "@/lib/enrolment";
import { AppShell } from "@/components/app-shell";
import { QuizForm } from "./quiz-form";

export default async function TakeAssessmentPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { id, assessmentId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  // The enrolment is loaded first so the same ownership rule that guards the
  // course also guards its assessments.
  try {
    await getEnrolmentForDelivery(session, id);
  } catch (error) {
    if (error instanceof EnrolmentError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  let view;
  try {
    view = await getAssessmentForLearner(session, assessmentId);
  } catch (error) {
    if (error instanceof AssessmentError) notFound();
    throw error;
  }

  const attemptsUsed = view.attempts.length;
  const attemptsLeft = view.assessment.maxAttempts
    ? view.assessment.maxAttempts - attemptsUsed
    : null;

  const latest = view.attempts[0];

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/learn/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← Back to the course
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {view.assessment.title}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pass mark {view.assessment.passMark}%
          {attemptsLeft !== null
            ? ` · ${attemptsLeft} of ${view.assessment.maxAttempts} attempts left`
            : ""}
          {view.assessment.purpose === "summative"
            ? " · counts towards your qualification"
            : " · practice"}
        </p>
        {view.assessment.instructions ? (
          <p className="mt-3 max-w-2xl text-sm">
            {view.assessment.instructions}
          </p>
        ) : null}
      </div>

      {latest ? (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Your last attempt
          </h2>
          <p className="mt-2 text-sm">
            Scored {latest.autoScore} of {latest.maxScore}.{" "}
            {latest.status === "submitted"
              ? "Waiting for an assessor to review it."
              : latest.status === "moderated"
                ? "Reviewed and moderated."
                : "Recorded."}
          </p>
        </section>
      ) : null}

      {attemptsLeft !== null && attemptsLeft <= 0 ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-sm">
            You have used all your attempts at this assessment.
          </p>
        </section>
      ) : (
        <QuizForm
          enrolmentId={id}
          assessmentId={assessmentId}
          items={view.items.map((item) => ({
            id: item.id,
            stem: item.stem,
            type: item.type,
            points: item.points,
            options: item.options ?? [],
          }))}
        />
      )}
    </AppShell>
  );
}
