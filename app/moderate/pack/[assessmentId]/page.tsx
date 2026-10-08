import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { assembleModerationPack } from "@/lib/moderation-pack";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell, Card } from "@/components/app-shell";

/**
 * The pack an accreditation visit asks for, assembled in one action.
 *
 * Every piece already existed; what was missing was putting them together.
 * Two things it deliberately does not do: choose a flattering sample, and omit
 * the awkward parts. Both are what a moderator would notice first.
 */
export default async function ModerationPackPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:moderate");
  const { t, day, when } = await pageLocale();
  const outcome = (value: string) => maybe(t, `outcome.${value}`) ?? value.replace(/_/g, " ");

  let pack;
  try {
    pack = await assembleModerationPack(session, assessmentId);
  } catch {
    notFound();
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6 print:hidden">
        <Link href="/moderate" className="text-sm text-[var(--muted)] hover:underline">
          {t("pack.back")}
        </Link>
        <p className="mt-2 text-sm text-[var(--muted)]">{t("pack.print")}</p>
      </div>

      <header className="mb-6 border-b border-[var(--border)] pb-4">
        <h1 className="text-xl font-semibold">{pack.assessment.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("pack.settings", {
            provider: pack.provider.name,
            accreditation: pack.accreditation.label,
            pass: pack.assessment.passMark,
            rate: Math.round(pack.assessment.moderationSampleRate * 100),
          })}
        </p>
        <p className="mt-1 text-sm tabular-nums">
          {t("pack.counts", {
            submissions: pack.counts.submissions,
            decided: pack.counts.decided,
            moderated: pack.counts.moderated,
            sampled: pack.counts.sampled,
          })}
        </p>
      </header>

      <div className="space-y-6 text-sm">
        <Card title={t("pack.instrument")} description={t("pack.instrumentIntro")}>
          {pack.papers.map((paper) => (
            <div key={paper.code} className="mb-3">
              <p className="font-medium">{t("pack.paper", { code: paper.code })}</p>
              <ul className="mt-1 text-[var(--muted)]">
                {paper.sections.map((section) => (
                  <li key={section.title}>
                    {t("pack.section", {
                      title: section.title,
                      marks: section.markTotal ?? "?",
                      questions: section.questions,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <ol className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
            {pack.memorandum.map((entry, index) => (
              <li key={index}>
                <p className="font-medium">
                  <span className="mr-2 tabular-nums text-[var(--muted)]">
                    {index + 1}.
                  </span>
                  {entry.stem}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {t("pack.marks", { marks: entry.points })}
                  </span>
                </p>
                {entry.correctOption ? (
                  <p className="pl-6 text-[var(--success)]">
                    {t("pack.correct", { option: entry.correctOption })}
                  </p>
                ) : null}
                {entry.markingGuide ? (
                  <p className="pl-6 text-[var(--muted)]">{entry.markingGuide}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>

        <Card
          title={t("pack.scripts", { count: pack.scripts.length })}
          description={t("pack.scriptsIntro")}
        >
          <ul className="space-y-2">
            {pack.scripts.map((script) => (
              <li
                key={script.submissionId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-2"
              >
                <span>
                  {script.learner}
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {t("pack.script", {
                      attempt: script.attemptNumber,
                      awarded: script.marksAwarded,
                      available: script.marksAvailable,
                      percent: Math.round(script.percentage),
                    })}
                    {" · "}
                    {script.outcome ? outcome(script.outcome) : t("pack.notDecided")}
                  </span>
                </span>
                <Link
                  href={`/assess/${script.submissionId}/record`}
                  className="text-xs underline underline-offset-2 print:hidden"
                >
                  {t("pack.openScript")}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title={t("pack.departures", { count: pack.overturned.length })}
          description={t("pack.departuresIntro")}
        >
          {pack.overturned.length === 0 ? (
            <p className="text-[var(--muted)]">{t("pack.none")}</p>
          ) : (
            <ul className="space-y-3">
              {pack.overturned.map((script) => (
                <li key={script.submissionId}>
                  <p className="font-medium">{script.learner}</p>
                  {script.departures.map((departure) => (
                    <p key={departure.criterionId} className="pl-4">
                      {t("pack.departure", {
                        proposed: outcome(departure.proposed),
                        decided: outcome(departure.decided),
                        reason: departure.reason ?? t("pack.noReason"),
                      })}
                    </p>
                  ))}
                  {script.moderation ? (
                    <p className="pl-4 text-[var(--muted)]">
                      {t("pack.moderator", {
                        moderator: script.moderation.moderator,
                        outcome: maybe(t, `moderation.${script.moderation.outcome}`) ?? script.moderation.outcome,
                      })}
                      {script.moderation.comments ? `: ${script.moderation.comments}` : ""}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t("pack.exceptions", { count: pack.overrides.length })}
          description={t("pack.exceptionsIntro")}
        >
          {pack.overrides.length === 0 ? (
            <p className="text-[var(--muted)]">{t("pack.none")}</p>
          ) : (
            <ul className="space-y-1">
              {pack.overrides.map((override, index) => (
                <li key={index}>
                  {override.learner} · {override.stepTitle ?? t("pack.aStep")} ·{" "}
                  {override.reason}
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {override.grantedBy}, {day(override.grantedAt)}
                    {override.revokedAt ? ` ${t("pack.withdrawn")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs text-[var(--muted)]">
          {t("pack.assembled", { date: when(pack.assembledAt) })}
        </p>
      </div>
    </AppShell>
  );
}
