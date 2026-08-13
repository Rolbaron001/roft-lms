import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { getLogbook } from "@/lib/workplace";
import { AppShell, Card } from "@/components/app-shell";
import { LogbookPanel } from "./logbook-panel";

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function LogbookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  // Who may see this is decided in the data layer, so a coach cannot reach
  // another employer's learner by typing an address.
  const view = await getLogbook(session, id);
  const { logbook, agreement, module, learner, entries, outstanding } = view;

  const canAccept =
    logbook.status === "coach_signed" &&
    session.permissions.includes("assessment:assess") &&
    logbook.learnerId !== session.userId;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/workplace"
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          ← All work experience
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{module?.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          <span className="font-mono">{module?.code}</span>
          {module?.credits ? ` · ${module.credits} credits` : ""} ·{" "}
          {learner?.firstName} {learner?.lastName}
        </p>
      </div>

      <Card>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              Employer
            </p>
            <p>{agreement?.employerName}</p>
            {agreement?.employerAddress ? (
              <p className="text-[var(--muted)]">{agreement.employerAddress}</p>
            ) : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              Workplace coach
            </p>
            <p>{agreement?.coachName}</p>
            <p className="text-[var(--muted)]">
              {agreement?.coachDesignation
                ? `${agreement.coachDesignation} · `
                : ""}
              {agreement?.coachEmail}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              Hours claimed
            </p>
            <p>{logbook.hoursClaimed ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              Signed
            </p>
            <p>
              {logbook.coachSignedAt
                ? formatDate(logbook.coachSignedAt)
                : "Not yet"}
            </p>
          </div>
        </div>

        {logbook.coachComments ? (
          <p className="mt-4 border-t border-[var(--border)] pt-3 text-sm">
            <span className="text-[var(--muted)]">Coach&rsquo;s note: </span>
            {logbook.coachComments}
          </p>
        ) : null}

        {logbook.coachSignatureHash ? (
          <p className="mt-3 break-all font-mono text-[11px] text-[var(--muted)]">
            Signature {logbook.coachSignatureHash}
          </p>
        ) : null}
      </Card>

      {logbook.status === "coach_signed" ||
      logbook.status === "accepted_by_assessor" ? (
        <p className="mt-4">
          <Link
            href={`/workplace/${id}/statement`}
            className="text-sm underline underline-offset-2"
          >
            Statement of Work Experience →
          </Link>
        </p>
      ) : null}

      <div className="mt-6">
        <LogbookPanel
          logbookId={id}
          entries={entries}
          canEdit={view.canEdit}
          canSign={view.canSign}
          canAccept={canAccept}
          outstanding={outstanding}
        />
      </div>
    </AppShell>
  );
}
