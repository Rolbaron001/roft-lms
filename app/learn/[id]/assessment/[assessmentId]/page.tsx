import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { AssessmentError, getAssessmentForLearner } from "@/lib/assessment";
import { EnrolmentError, getEnrolmentForDelivery } from "@/lib/enrolment";
import { getFeedback, sectionComments } from "@/lib/marking";
import { AppShell } from "@/components/app-shell";
import { QuizForm } from "./quiz-form";
import { EvidenceForm } from "./evidence-form";

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

  /**
   * What the facilitator wrote back.
   *
   * Until now this screen showed a learner their mark and nothing else, while
   * the overall comment, the criteria of concern and every per-section comment
   * sat in the database unread. Feedback that is written and never delivered is
   * worse than none: the facilitator believes the learner has it.
   */
  const feedback = latest ? await getFeedback(session, latest.id) : null;
  const sections = feedback ? await sectionComments(session, latest.id) : [];

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

          {feedback ? (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <h3 className="text-sm font-semibold">
                Feedback from your facilitator
              </h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {feedback.marksAwarded} of {feedback.marksAvailable} marks
                {feedback.returnedAt ? (
                  <>
                    {" · returned "}
                    {feedback.returnedAt.toLocaleDateString("en-ZA", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </>
                ) : null}
              </p>

              <p className="mt-3 whitespace-pre-wrap text-sm">
                {feedback.comments}
              </p>

              {sections.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {sections.map((section) => (
                    <li
                      key={section.sectionId}
                      className="rounded-md border border-[var(--border)] px-4 py-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {section.title}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">
                        {section.comments}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}

              {feedback.criteriaOfConcern.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Worth going back over
                  </p>
                  <ul className="mt-1 space-y-1">
                    {feedback.criteriaOfConcern.map((criterion) => (
                      <li key={criterion.code} className="text-sm">
                        <span className="font-mono text-xs">
                          {criterion.code}
                        </span>{" "}
                        {criterion.description}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    This is developmental. Nothing here counts against you.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {attemptsLeft !== null && attemptsLeft <= 0 ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-sm">
            You have used all your attempts at this assessment.
          </p>
        </section>
      ) : view.assessment.type === "quiz" ? (
        <QuizForm
          enrolmentId={id}
          assessmentId={assessmentId}
          items={view.items.map((item) => ({
            id: item.id,
            stem: item.stem,
            type: item.type,
            points: item.points,
            options: item.options ?? [],
            matchPrompts: item.matchPrompts,
          }))}
          savedAnswers={view.draft?.answers}
        />
      ) : (
        // Evidence, practical observation and workplace logbook are all
        // "upload what you did" from the learner's side.
        <EvidenceForm assessmentId={assessmentId} enrolmentId={id} />
      )}
    </AppShell>
  );
}
