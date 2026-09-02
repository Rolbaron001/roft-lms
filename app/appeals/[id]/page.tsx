import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requirePermission, requireTenant } from "@/lib/request";
import { AppealError, appealDetail } from "@/lib/appeals";
import { withTenant } from "@/db/client";
import { userRoles, users } from "@/db/schema";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { ZonedTime } from "@/components/zoned-time";
import { Work } from "./work";

const GROUND_LABEL: Record<string, string> = {
  result: "Against a result",
  assessor_conduct: "Against an assessor's conduct",
};

export default async function AppealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("appeal:manage");

  let detail;
  try {
    detail = await appealDetail(session, id);
  } catch (error) {
    if (error instanceof AppealError) notFound();
    throw error;
  }

  const { appeal, notes } = detail;

  // Only people who actually hold the moderating role can be named as the
  // moderator consulted. Offering everybody would make the required step
  // satisfiable by naming whoever happened to be nearby.
  const moderators = await withTenant(session.organisationId, async (tx) => {
    const found = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(eq(userRoles.role, "moderator"))
      .orderBy(users.lastName);

    return found.map((person) => ({
      id: person.id,
      name: `${person.firstName} ${person.lastName}`,
    }));
  });

  return (
    <AppShell tenant={tenant} session={session}>
      <Link
        href="/appeals"
        className="text-sm text-[var(--muted)] hover:underline"
      >
        ← Back to appeals
      </Link>

      <h1 className="mt-2 text-xl font-semibold">{appeal.learnerName}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {appeal.cohortName} · {GROUND_LABEL[appeal.ground]}
        {appeal.assessmentTitle ? ` · ${appeal.assessmentTitle}` : ""}
      </p>

      <div className="mt-6">
        <Card
          title="What the learner says"
          description={`Triggered ${appeal.triggeredOn}, lodged ${appeal.lodgedOn}.`}
        >
          <p className="whitespace-pre-wrap text-sm">{appeal.statement}</p>

          {appeal.lateAcceptanceReason ? (
            <div className="mt-4 rounded-md border border-[var(--border)] p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Accepted out of time
              </p>
              <p className="mt-1 text-sm">{appeal.lateAcceptanceReason}</p>
            </div>
          ) : null}

          <p className="mt-4 text-xs text-[var(--muted)]">
            Lodged{" "}
            <ZonedTime at={appeal.lodgedAt} zone={tenant.timezone} withDate />.
          </p>
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="The procedure"
          description="Acknowledge, meet the learner, consult the moderator where the ground is a result, then resolve and tell them."
        >
          <Work
            appeal={{
              id: appeal.id,
              ground: appeal.ground,
              status: appeal.status,
              acknowledgedAt: appeal.acknowledgedAt,
              metLearnerOn: appeal.metLearnerOn,
              moderatorId: appeal.moderatorId,
              moderatorName: appeal.moderatorName,
              outcome: appeal.outcome,
              outcomeReason: appeal.outcomeReason,
              resolvedAt: appeal.resolvedAt,
              learnerInformedAt: appeal.learnerInformedAt,
              withdrawnReason: appeal.withdrawnReason,
            }}
            zone={tenant.timezone}
            moderators={moderators}
            notes={notes}
          />
        </Card>
      </div>
    </AppShell>
  );
}
