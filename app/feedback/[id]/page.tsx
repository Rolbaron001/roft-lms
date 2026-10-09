import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { vocabulary } from "@/lib/terms";
import { Rich } from "@/components/rich-text";
import { FeedbackError, feedbackOwedBy, feedbackSummary } from "@/lib/feedback";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { ZonedTime } from "@/components/zoned-time";
import { AnswerForm } from "./answer-form";

/**
 * One feedback request: the form if you owe it, the report if you can read it.
 *
 * One route for both because they are the same object seen from two sides, and
 * because a facilitator who is also enrolled on something should not have to
 * learn two addresses.
 */
export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);

  // Owing a form comes first. Somebody who can also read the report is far more
  // likely to have arrived here to answer than to analyse.
  const owed = await feedbackOwedBy(session, session.userId);
  const mine = owed.find((row) => row.id === id);

  if (mine) {
    return (
      <AppShell tenant={tenant} session={session}>
        <h1 className="text-xl font-semibold">
          {mine.assessmentTitle ?? t("feedbackForm.programme", { programme: words.lowerOne("programme") })}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("feedbackForm.intro", { cohort: mine.cohortName })}
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          <Rich
            text={t("feedbackForm.askedBy")}
            parts={{ time: <ZonedTime at={mine.dueAt} zone={tenant.timezone} withDate /> }}
          />
        </p>

        <div className="mt-6">
          <Card title={t("feedbackForm.yours")} description="">
            <AnswerForm requestId={id} questions={mine.questions} />
          </Card>
        </div>
      </AppShell>
    );
  }

  if (!session.permissions.includes("report:tenant")) notFound();

  let summary;
  try {
    summary = await feedbackSummary(session, id);
  } catch (error) {
    if (error instanceof FeedbackError) notFound();
    throw error;
  }

  const rate =
    summary.invited === 0
      ? 0
      : Math.round((summary.answered / summary.invited) * 100);

  return (
    <AppShell tenant={tenant} session={session}>
      <Link
        href={`/cohorts/${summary.cohortId}`}
        className="text-sm text-[var(--muted)] hover:underline"
      >
        {t("feedbackReport.back")}
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {summary.assessmentTitle ?? t("feedbackReport.title", { programme: words.one("programme") })}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        <Rich
          text={t("feedbackReport.asked", {
            cohort: summary.cohortName,
            answered: summary.answered,
            invited: summary.invited,
            rate,
          })}
          parts={{
            time: <ZonedTime at={summary.sentAt} zone={tenant.timezone} withDate showViewer={false} />,
          }}
        />
        {summary.late > 0 ? ` · ${t("feedbackReport.late", { count: summary.late })}` : ""}
      </p>

      <div className="mt-6">
        <Card title={t("feedbackReport.ratings")} description={t("feedbackReport.ratingsNote")}>
          {summary.ratings.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("feedbackReport.noRatings")}</p>
          ) : (
            <ul className="space-y-3">
              {summary.ratings.map((rating) => (
                <li key={rating.key}>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span>{rating.prompt}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      {rating.count === 0 ? "—" : t("feedbackReport.outOf", { mean: rating.mean.toFixed(1), points: rating.points })}
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {rating.count === 1
                          ? t("feedbackReport.answerOne")
                          : t("feedbackReport.answers", { count: rating.count })}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-[var(--border)]">
                    <div
                      className="h-1.5 rounded bg-[var(--brand-primary)]"
                      style={{ width: `${(rating.mean / rating.points) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title={t("feedbackReport.said")} description={t("feedbackReport.saidNote")}>
          {summary.comments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("feedbackReport.noComments")}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {summary.comments.map((comment, index) => (
                <li key={index}>
                  <p className="text-xs text-[var(--muted)]">
                    {comment.prompt}
                  </p>
                  <p className="whitespace-pre-wrap">{comment.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {summary.outstanding.length > 0 ? (
        <div className="mt-6">
          <Card title={t("feedbackReport.outstanding")} description={t("feedbackReport.outstandingNote")}>
            <p className="text-sm">
              {summary.outstanding.map((person) => person.name).join(", ")}
            </p>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
