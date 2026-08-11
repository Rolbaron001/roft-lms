import { requirePermission, requireTenant } from "@/lib/request";
import { listModerationQueue } from "@/lib/assessment";
import { AppShell, Card } from "@/components/app-shell";
import { ModerationList } from "./moderation-list";

const REASON_LABELS: Record<string, string> = {
  full_moderation: "Summative — every decision is moderated",
  new_assessor: "Newly registered assessor — moderated in full",
  random_sample: "Selected by random sample",
};

export default async function ModerationQueuePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:moderate");
  const queue = await listModerationQueue(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Waiting for moderation</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Independent review of assessors&rsquo; decisions. Which decisions
          reach this list is decided by the system, not chosen by anyone. You
          cannot moderate a decision you made yourself.
        </p>
      </div>

      {queue.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            Nothing is waiting for moderation.
          </p>
        </Card>
      ) : (
        <ModerationList
          items={queue.map((row) => ({
            decisionId: row.decisionId,
            outcome: row.outcome,
            reason: REASON_LABELS[row.samplingReason] ?? row.samplingReason,
            assessorName: `${row.assessorFirstName} ${row.assessorLastName}`,
            assessorId: row.assessorId,
            assessmentTitle: row.assessmentTitle,
            courseTitle: row.courseTitle,
            submissionId: row.submissionId,
          }))}
          currentUserId={session.userId}
        />
      )}
    </AppShell>
  );
}
