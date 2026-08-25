import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { AssessmentError, getSubmissionForAssessment } from "@/lib/assessment";
import { AppShell } from "@/components/app-shell";
import { DecisionForm } from "./decision-form";

export default async function AssessSubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:assess");

  let detail;
  try {
    detail = await getSubmissionForAssessment(session, id);
  } catch (error) {
    if (error instanceof AssessmentError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  const isOwnWork = detail.submission.userId === session.userId;

  // A paper is marked question by question on its own screen; this one records
  // the judgement. Answers for a paper live in item_responses rather than in
  // the submission's own responses column, so sending the assessor there is
  // not a convenience — it is where the work actually is.
  const isPaper = detail.submission.paperId !== null;

  // Answers are shown beside the questions, which is what makes a judgement
  // possible without leaving the page.
  const responses = (detail.submission.responses ?? {}) as Record<
    string,
    string[] | string
  >;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/assess"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← Waiting to be assessed
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {detail.learner.firstName} {detail.learner.lastName}
        </h1>
        {isPaper ? (
          <p className="mt-3 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-3 py-2 text-sm">
            This was answered on screen.{" "}
            <Link
              href={`/assess/${id}/mark`}
              className="font-semibold underline underline-offset-2"
            >
              Mark it question by question
            </Link>{" "}
            — the answers, the marking guidance and the matrix are together
            there, and the criteria are worked out for you once it is marked.
          </p>
        ) : null}
        <p className="mt-1 text-sm text-[var(--muted)]">
          {detail.assessment.title} · attempt{" "}
          {detail.submission.attemptNumber}
          {detail.submission.maxScore
            ? ` · scored ${detail.submission.autoScore} of ${detail.submission.maxScore}`
            : ""}
        </p>
      </div>

      {isOwnWork ? (
        <section className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-5">
          <p className="text-sm text-[var(--danger)]">
            This is your own submission. You cannot assess it — someone else
            must.
          </p>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-6">
            {detail.items.length > 0 ? (
              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  What the learner answered
                </h2>
                <ol className="mt-4 space-y-4">
                  {detail.items.map((item, index) => {
                    const given = responses[item.id];
                    const givenIds = Array.isArray(given)
                      ? given
                      : given
                        ? [given]
                        : [];
                    const correct = item.correctOptionIds ?? [];

                    return (
                      <li
                        key={item.id}
                        className="rounded-md border border-[var(--border)] p-4"
                      >
                        <p className="text-sm font-medium">
                          {index + 1}. {item.stem}
                        </p>
                        <ul className="mt-2 space-y-1">
                          {(item.options ?? []).map((option) => {
                            const chosen = givenIds.includes(option.id);
                            const isCorrect = correct.includes(option.id);
                            return (
                              <li
                                key={option.id}
                                className={`text-sm ${
                                  isCorrect
                                    ? "font-medium text-[var(--success)]"
                                    : chosen
                                      ? "text-[var(--danger)]"
                                      : "text-[var(--muted)]"
                                }`}
                              >
                                {chosen ? "◉" : "○"} {option.text}
                                {isCorrect ? " (correct)" : ""}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}

            {detail.artifacts.length > 0 ? (
              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Evidence submitted
                </h2>
                <ul className="mt-4 space-y-2">
                  {detail.artifacts.map((artifact) => (
                    <li
                      key={artifact.id}
                      className="rounded-md border border-[var(--border)] px-4 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="font-medium">{artifact.filename}</p>
                        <a
                          href={`/api/evidence/${artifact.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-[var(--brand-accent)] hover:underline"
                        >
                          Open
                        </a>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {Math.round(artifact.sizeBytes / 1024)} KB · uploaded{" "}
                        {artifact.uploadedAt.toLocaleString("en-ZA")}
                      </p>

                      {/* An image or video is shown here rather than made a
                          download, because an assessor judging a practical
                          task should not have to leave the criteria to see
                          the evidence. */}
                      {artifact.mimeType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/evidence/${artifact.id}`}
                          alt={artifact.filename}
                          className="mt-3 max-h-96 rounded-md border border-[var(--border)]"
                        />
                      ) : artifact.mimeType.startsWith("video/") ? (
                        <video
                          controls
                          preload="metadata"
                          className="mt-3 w-full rounded-md border border-[var(--border)] bg-black"
                          style={{ maxHeight: "24rem" }}
                        >
                          <source
                            src={`/api/evidence/${artifact.id}`}
                            type={artifact.mimeType}
                          />
                        </video>
                      ) : null}

                      <p className="mt-2 font-mono text-[11px] break-all text-[var(--muted)]">
                        SHA-256 {artifact.sha256}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-[var(--muted)]">
                  The hash is recorded at upload. If a stored file is ever
                  altered, it no longer matches and the record is flagged.
                </p>
              </section>
            ) : null}

            {detail.decisions.length > 0 ? (
              <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Decisions already recorded
                </h2>
                <ul className="mt-4 space-y-2">
                  {detail.decisions.map((decision) => (
                    <li key={decision.id} className="text-sm">
                      <span className="font-medium capitalize">
                        {decision.outcome.replace(/_/g, " ")}
                      </span>{" "}
                      by {decision.assessorFirstName} {decision.assessorLastName}{" "}
                      on {decision.signedAt.toLocaleDateString("en-ZA")}
                      {decision.comments ? (
                        <span className="block text-[var(--muted)]">
                          {decision.comments}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <DecisionForm
            submissionId={id}
            criteria={detail.criteria.map((criterion) => ({
              id: criterion.id,
              code: criterion.code,
              description: criterion.description,
            }))}
          />
        </div>
      )}
    </AppShell>
  );
}
