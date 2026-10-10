import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { listModerationQueue } from "@/lib/assessment";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell, Card } from "@/components/app-shell";
import { ModerationList } from "./moderation-list";
import { AssignedNote } from "@/components/assigned-note";

export default async function ModerationQueuePage() {
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:moderate");
  const t = await pageT();
  const queue = await listModerationQueue(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <AssignedNote session={session} />
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("moderating.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("moderating.intro")}</p>
      </div>

      {queue.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t("moderating.empty")}</p>
        </Card>
      ) : (
        <ModerationList
          items={queue.map((row) => ({
            decisionId: row.decisionId,
            outcome: row.outcome,
            reason: maybe(t, `moderating.reason.${row.samplingReason}`) ?? row.samplingReason,
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
