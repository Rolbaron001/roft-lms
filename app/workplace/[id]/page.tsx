import Link from "next/link";
import { pageDates, requireSession, requireTenant } from "@/lib/request";
import type { DateWriter } from "@/lib/date-format";
import { getLogbook } from "@/lib/workplace";
import { AppShell, Card } from "@/components/app-shell";
import { LogbookPanel } from "./logbook-panel";
import { translator } from "@/lib/i18n";
import { localeFor } from "@/lib/i18n/locales";

function formatDate(value: Date | null, day: DateWriter["day"]): string {
  if (!value) return "—";
  return day(value, { short: true });
}

export default async function LogbookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const locale = localeFor(tenant, session);
  const t = translator(locale);

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
          {t("work.all")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{module?.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          <span className="font-mono">{module?.code}</span>
          {module?.credits ? ` · ${t("work.credits", { credits: module.credits })}` : ""} ·{" "}
          {learner?.firstName} {learner?.lastName}
        </p>
      </div>

      <Card>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              {t("work.employer")}
            </p>
            <p>{agreement?.employerName}</p>
            {agreement?.employerAddress ? (
              <p className="text-[var(--muted)]">{agreement.employerAddress}</p>
            ) : null}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              {t("work.coach")}
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
              {t("work.hours")}
            </p>
            <p>{logbook.hoursClaimed ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
              {t("work.signed")}
            </p>
            <p>
              {logbook.coachSignedAt
                ? formatDate(logbook.coachSignedAt, (await pageDates()).day)
                : t("work.notYet")}
            </p>
          </div>
        </div>

        {logbook.coachComments ? (
          <p className="mt-4 border-t border-[var(--border)] pt-3 text-sm">
            <span className="text-[var(--muted)]">{t("work.coachNote")} </span>
            {logbook.coachComments}
          </p>
        ) : null}

        {logbook.coachSignatureHash ? (
          <p className="mt-3 break-all font-mono text-[11px] text-[var(--muted)]">
            {t("work.signature", { hash: logbook.coachSignatureHash })}
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
            {t("work.statement")}
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
