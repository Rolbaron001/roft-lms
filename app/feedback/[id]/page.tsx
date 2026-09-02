import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
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

  // Owing a form comes first. Somebody who can also read the report is far more
  // likely to have arrived here to answer than to analyse.
  const owed = await feedbackOwedBy(session, session.userId);
  const mine = owed.find((row) => row.id === id);

  if (mine) {
    return (
      <AppShell tenant={tenant} session={session}>
        <h1 className="text-xl font-semibold">
          {mine.assessmentTitle ?? "The programme"}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {mine.cohortName}. Answers are reported together with everybody
          else&rsquo;s, not one by one. It takes about two minutes, and it is
          the only thing that changes how the next cohort is run.
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Asked for by <ZonedTime at={mine.dueAt} zone={tenant.timezone} withDate />.
        </p>

        <div className="mt-6">
          <Card title="Your answers" description="">
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
        ← Back to the cohort
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {summary.assessmentTitle ?? "Programme feedback"}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {summary.cohortName} · asked{" "}
        <ZonedTime at={summary.sentAt} zone={tenant.timezone} withDate showViewer={false} />{" "}
        · {summary.answered} of {summary.invited} answered ({rate}%)
        {summary.late > 0 ? ` · ${summary.late} after the 48 hours` : ""}
      </p>

      <div className="mt-6">
        <Card
          title="Ratings"
          description="Mean of 1 (strongly disagree) to 5 (strongly agree). A mean over few answers is a mood, not a measurement, so the count is beside it."
        >
          {summary.ratings.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing rated yet.</p>
          ) : (
            <ul className="space-y-3">
              {summary.ratings.map((rating) => (
                <li key={rating.key}>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span>{rating.prompt}</span>
                    <span className="tabular-nums whitespace-nowrap">
                      {rating.count === 0 ? "—" : rating.mean.toFixed(1)}
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {rating.count}{" "}
                        {rating.count === 1 ? "answer" : "answers"}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-[var(--border)]">
                    <div
                      className="h-1.5 rounded bg-[var(--brand-primary)]"
                      style={{ width: `${(rating.mean / 5) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="What they said"
          description="Shown together and without names. Feedback about a facilitator is only honest if the learner believes it will not be read back to them one by one."
        >
          {summary.comments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing written yet.</p>
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
          <Card
            title="Still to answer"
            description="The one place a name appears. Chasing needs them; the answers above do not."
          >
            <p className="text-sm">
              {summary.outstanding.map((person) => person.name).join(", ")}
            </p>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
