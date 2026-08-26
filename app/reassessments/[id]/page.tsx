import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  criteriaForAssessment,
  oralAssessmentFor,
  ReassessmentError,
} from "@/lib/reassessment";
import { AppShell, Card } from "@/components/app-shell";
import { OralRecord } from "./oral-record";

/**
 * Conducting the oral third attempt.
 *
 * The screen is the record, not the assessment: the assessment is a
 * conversation happening in a room. What this has to do is make writing it
 * down as it happens easier than reconstructing it afterwards, because
 * reconstructed evidence is the kind that falls over at verification.
 *
 * The outcome is not recorded here. It goes through the ordinary marking
 * screen, against the ordinary criteria, so it reaches the criterion ledger by
 * the same route as the two written attempts before it.
 */
export default async function OralAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  let detail;
  try {
    detail = await oralAssessmentFor(session, id);
  } catch (error) {
    if (error instanceof ReassessmentError) notFound();
    throw error;
  }

  const criteria = await criteriaForAssessment(
    session,
    detail.authorisation.assessmentId,
  );

  const canAssess = session.permissions.includes("assessment:assess");
  const review = detail.authorisation;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/reassessments"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← Held for review
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          Oral assessment — {detail.learner?.firstName}{" "}
          {detail.learner?.lastName}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {detail.assessmentTitle} · attempt{" "}
          {detail.submission.attemptNumber}
        </p>
      </div>

      <Card
        title="What the review decided"
        description="The grounds on which this third attempt was authorised."
      >
        <p className="text-sm">{review.rationale}</p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {review.employerConsulted
            ? `Employer consulted: ${review.employerRepresentative}`
            : "The employer was not consulted."}
          {review.employerComments ? ` — “${review.employerComments}”` : ""}
        </p>
      </Card>

      <div className="mt-6">
        <Card
          title="The record"
          description="An oral attempt leaves no evidence of its own. This is that evidence, and the outcome cannot be recorded without it."
        >
          {canAssess ? (
            <OralRecord
              submissionId={id}
              criteria={criteria}
              existing={detail.record?.exchanges ?? []}
              medium={detail.record?.medium ?? null}
              witnessName={detail.record?.witnessName ?? null}
            />
          ) : detail.record ? (
            <ul className="space-y-3 text-sm">
              {detail.record.exchanges.map((exchange, index) => (
                <li key={index}>
                  <p className="font-medium">{exchange.question}</p>
                  <p className="mt-0.5">{exchange.response}</p>
                  {exchange.note ? (
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {exchange.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Nothing has been recorded yet.
            </p>
          )}
        </Card>
      </div>

      {canAssess && detail.record ? (
        <div className="mt-6">
          <Card
            title="Recording the outcome"
            description="Judged the same way as a written attempt, against the same criteria, and moderated the same way afterwards."
          >
            <Link
              href={`/assess/${id}`}
              className="inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "var(--brand-primary)" }}
            >
              Go to the marking screen
            </Link>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
