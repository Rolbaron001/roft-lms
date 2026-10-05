import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { AssessmentError, getAssessmentForLearner } from "@/lib/assessment";
import { DEFAULT_DECLARATION } from "@/lib/declaration";
import { EnrolmentError, getEnrolmentForDelivery } from "@/lib/enrolment";
import { getFeedback, sectionComments } from "@/lib/marking";
import { AppShell } from "@/components/app-shell";
import { translator } from "@/lib/i18n";
import { dateLocale, localeFor } from "@/lib/i18n/locales";
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
  const locale = localeFor(tenant, session);
  const t = translator(locale);

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
          href={`/learn/${id}#a-${assessmentId}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          {t("assess.back")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {view.assessment.title}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("assess.passMark", { mark: view.assessment.passMark })}
          {attemptsLeft !== null
            ? ` · ${t("assess.attemptsLeft", { left: attemptsLeft, max: view.assessment.maxAttempts ?? 0 })}`
            : ""}
          {" · "}
          {view.assessment.purpose === "summative"
            ? t("assess.counts")
            : t("assess.practice")}
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
            {t("assess.lastAttempt")}
          </h2>
          <p className="mt-2 text-sm">
            {t("assess.scored", { score: latest.autoScore ?? 0, max: latest.maxScore ?? 0 })}{" "}
            {latest.status === "submitted"
              ? t("assess.waiting")
              : latest.status === "moderated"
                ? t("assess.moderated")
                : t("assess.recorded")}
          </p>

          {feedback ? (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <h3 className="text-sm font-semibold">
                {t("assess.feedback")}
              </h3>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {t("assess.marksOf", {
                  awarded: feedback.marksAwarded ?? 0,
                  available: feedback.marksAvailable ?? 0,
                })}
                {feedback.returnedAt ? (
                  <>
                    {" · "}
                    {t("assess.returned", {
                      date: feedback.returnedAt.toLocaleDateString(dateLocale(locale), {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      }),
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
                    {t("assess.goBackOver")}
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
                    {t("assess.developmental")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {view.competent ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-sm">{t("assess.competent")}</p>
        </section>
      ) : attemptsLeft !== null && attemptsLeft <= 0 ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-sm">{t("assess.noAttempts")}</p>
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
          declaration={
            view.assessment.purpose === "summative"
              ? view.assessment.declarationText?.trim() || DEFAULT_DECLARATION
              : null
          }
        />
      ) : (
        // Evidence, practical observation and workplace logbook are all
        // "upload what you did" from the learner's side.
        <EvidenceForm assessmentId={assessmentId} enrolmentId={id} />
      )}
    </AppShell>
  );
}
