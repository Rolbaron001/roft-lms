import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { portfolioRecord } from "@/lib/moderation-pack";
import { AppShell } from "@/components/app-shell";

/**
 * A learner's record for one attempt, laid out to be printed.
 *
 * The artefact a verifier asks for by name. It is an ordinary page rather than
 * a generated PDF: every browser prints to PDF, and adding a PDF library would
 * be a dependency to solve a problem the print dialog already solves. What
 * matters is that it comes out of the record rather than being reconstructed
 * later from memory.
 */
export default async function PortfolioRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  let record;
  try {
    record = await portfolioRecord(session, id);
  } catch {
    notFound();
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6 print:hidden">
        <Link href="/assess" className="text-sm text-[var(--muted)] hover:underline">
          ← Back
        </Link>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Print this page to keep it as a PDF for the portfolio of evidence.
        </p>
      </div>

      <article className="space-y-6 text-sm">
        <header className="border-b border-[var(--border)] pb-4">
          <h1 className="text-xl font-semibold">{record.assessmentTitle}</h1>
          <p className="mt-1 text-[var(--muted)]">
            {record.learner} · attempt {record.attemptNumber} ·{" "}
            {record.purpose === "summative" ? "assessed" : "developmental"}
            {record.submittedAt
              ? ` · handed in ${record.submittedAt.toLocaleDateString("en-ZA", { dateStyle: "long" })}`
              : ""}
          </p>
          <p className="mt-2 font-medium tabular-nums">
            {record.marksAwarded} of {record.marksAvailable} marks
          </p>
        </header>

        {record.declarationText ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Declaration
            </h2>
            <p className="mt-1 leading-relaxed">{record.declarationText}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {record.declarationAcceptedAt
                ? `Accepted ${record.declarationAcceptedAt.toLocaleString("en-ZA")}.`
                : record.closedOnTime
                  ? "Not accepted: the time limit expired and the work was handed in as it stood."
                  : "Not accepted."}
            </p>
          </section>
        ) : null}

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Questions and answers
          </h2>
          <ol className="mt-3 space-y-5">
            {record.items.map((item, index) => (
              <li key={index}>
                <p className="font-medium">
                  <span className="mr-2 tabular-nums text-[var(--muted)]">
                    {index + 1}.
                  </span>
                  {item.stem}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {item.awarded ?? "—"} of {item.points}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap pl-6 leading-relaxed">
                  {item.answer}
                </p>
                {item.comment ? (
                  <p className="mt-1 pl-6 text-xs italic text-[var(--muted)]">
                    Assessor: {item.comment}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        {record.decision ? (
          <section className="border-t border-[var(--border)] pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Decision
            </h2>
            <p className="mt-1 font-medium">
              {record.decision.outcome === "competent"
                ? "Competent"
                : "Not yet competent"}
            </p>
            {record.decision.comments ? (
              <p className="mt-1">{record.decision.comments}</p>
            ) : null}
            <p className="mt-1 text-xs text-[var(--muted)]">
              {record.decision.assessor}
              {record.decision.registrationNumber
                ? ` (${record.decision.registrationNumber})`
                : ""}{" "}
              · {record.decision.signedAt.toLocaleDateString("en-ZA", { dateStyle: "long" })}
            </p>
          </section>
        ) : null}

        {record.moderation ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Moderation
            </h2>
            <p className="mt-1">
              {record.moderation.outcome} — {record.moderation.moderator}
            </p>
            {record.moderation.comments ? (
              <p className="mt-1 text-[var(--muted)]">
                {record.moderation.comments}
              </p>
            ) : null}
          </section>
        ) : null}

        {record.feedback ? (
          <section className="border-t border-[var(--border)] pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Feedback
            </h2>
            <p className="mt-1 whitespace-pre-wrap">{record.feedback.comments}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Returned{" "}
              {record.feedback.returnedAt.toLocaleDateString("en-ZA", {
                dateStyle: "long",
              })}
              . This is developmental: it records no competence.
            </p>
          </section>
        ) : null}
      </article>
    </AppShell>
  );
}
