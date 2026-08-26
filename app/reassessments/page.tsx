import { requirePermission, requireTenant } from "@/lib/request";
import { listHeldAndAuthorised } from "@/lib/reassessment";
import { AppShell, Card } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ReviewForm, StartOral } from "./review-form";

/**
 * Learners whose progress is held after a second not-yet-competent result.
 *
 * This list is the reason the held state is not simply a dead end. From the
 * learner's own screen, held looks like stuck: the assessment will not open
 * and nothing explains what happens next. Nothing prompts anybody unless the
 * people who can convene a review can see who is waiting for one.
 */
export default async function ReassessmentsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  const waiting = await listHeldAndAuthorised(session);

  const canReview = session.permissions.includes("enrolment:manage");
  const canAssess = session.permissions.includes("assessment:assess");

  const forReview = waiting.filter((row) => !row.awaitingOral);
  const forOral = waiting.filter((row) => row.awaitingOral);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Held for review</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          A learner found not yet competent twice is not failed. The assessment
          is held, and a programme review is convened with their employer —
          because by this point the question is rarely whether they know it, and
          usually what has been going on around them.
        </p>
      </div>

      {waiting.length === 0 ? (
        <EmptyState title="Nobody is held">
          This fills when a learner is found not yet competent for a second time
          on a summative assessment. Until then there is nothing to review.
        </EmptyState>
      ) : null}

      {forReview.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Waiting on a programme review ({forReview.length})
          </h2>

          {forReview.map((row) => (
            <Card
              key={`${row.assessmentId}-${row.userId}`}
              title={`${row.firstName} ${row.lastName}`}
              description={`${row.assessmentTitle} · ${row.notYetCompetent} not-yet-competent results`}
            >
              {canReview ? (
                <ReviewForm
                  assessmentId={row.assessmentId}
                  userId={row.userId}
                />
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  A facilitator or administrator convenes the review.
                </p>
              )}
            </Card>
          ))}
        </div>
      ) : null}

      {forOral.length > 0 ? (
        <div className="mt-8 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Authorised for an oral attempt ({forOral.length})
          </h2>

          {forOral.map((row) => (
            <Card
              key={`${row.assessmentId}-${row.userId}`}
              title={`${row.firstName} ${row.lastName}`}
              description={`${row.assessmentTitle} · the review authorised a third attempt, conducted orally`}
            >
              {canAssess && row.authorisationId ? (
                <StartOral authorisationId={row.authorisationId} />
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  An assessor conducts the oral attempt — and not the person who
                  authorised it.
                </p>
              )}
            </Card>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
