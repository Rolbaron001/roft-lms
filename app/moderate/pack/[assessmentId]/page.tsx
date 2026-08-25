import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { assembleModerationPack } from "@/lib/moderation-pack";
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
          ← To moderate
        </Link>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Print this page to keep it as a PDF.
        </p>
      </div>

      <header className="mb-6 border-b border-[var(--border)] pb-4">
        <h1 className="text-xl font-semibold">{pack.assessment.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {pack.provider.name}
          {pack.provider.accreditationNumber
            ? ` · ${pack.provider.accreditationNumber}`
            : ""}{" "}
          · pass mark {pack.assessment.passMark}% · moderation rate{" "}
          {Math.round(pack.assessment.moderationSampleRate * 100)}%
        </p>
        <p className="mt-1 text-sm tabular-nums">
          {pack.counts.submissions} submissions · {pack.counts.decided} decided ·{" "}
          {pack.counts.moderated} moderated · {pack.counts.sampled} sampled here
        </p>
      </header>

      <div className="space-y-6 text-sm">
        <Card
          title="The instrument"
          description="The paper as it was set, and the guidance it was marked against."
        >
          {pack.papers.map((paper) => (
            <div key={paper.code} className="mb-3">
              <p className="font-medium">Paper {paper.code}</p>
              <ul className="mt-1 text-[var(--muted)]">
                {paper.sections.map((section) => (
                  <li key={section.title}>
                    {section.title} — {section.markTotal ?? "?"} marks,{" "}
                    {section.questions} questions
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
                    {entry.points} marks
                  </span>
                </p>
                {entry.correctOption ? (
                  <p className="pl-6 text-[var(--success)]">
                    Correct: {entry.correctOption}
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
          title={`Sampled scripts (${pack.scripts.length})`}
          description="Taken across the mark range — top, bottom and spread between — so the marking is seen at its best and its worst rather than in the middle."
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
                    attempt {script.attemptNumber} ·{" "}
                    {script.marksAwarded}/{script.marksAvailable} (
                    {Math.round(script.percentage)}%)
                    {script.outcome ? ` · ${script.outcome}` : " · not decided"}
                  </span>
                </span>
                <Link
                  href={`/assess/${script.submissionId}/record`}
                  className="text-xs underline underline-offset-2 print:hidden"
                >
                  Open the script
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title={`Departures and overturns (${pack.overturned.length})`}
          description="Where an assessor differed from what the marks proposed, or a moderator differed from the assessor. A pack that leaves these out is worse than no pack."
        >
          {pack.overturned.length === 0 ? (
            <p className="text-[var(--muted)]">None.</p>
          ) : (
            <ul className="space-y-3">
              {pack.overturned.map((script) => (
                <li key={script.submissionId}>
                  <p className="font-medium">{script.learner}</p>
                  {script.departures.map((departure) => (
                    <p key={departure.criterionId} className="pl-4">
                      Proposed {departure.proposed.replace(/_/g, " ")}, decided{" "}
                      {departure.decided.replace(/_/g, " ")} —{" "}
                      {departure.reason ?? "no reason recorded"}
                    </p>
                  ))}
                  {script.moderation ? (
                    <p className="pl-4 text-[var(--muted)]">
                      Moderator {script.moderation.moderator}:{" "}
                      {script.moderation.outcome}
                      {script.moderation.comments
                        ? ` — ${script.moderation.comments}`
                        : ""}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={`Exceptions (${pack.overrides.length})`}
          description="Learners let past a gate by a named person, with the reason they gave."
        >
          {pack.overrides.length === 0 ? (
            <p className="text-[var(--muted)]">None.</p>
          ) : (
            <ul className="space-y-1">
              {pack.overrides.map((override, index) => (
                <li key={index}>
                  {override.learner} — {override.stepTitle ?? "a step"} —{" "}
                  {override.reason}
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {override.grantedBy},{" "}
                    {override.grantedAt.toLocaleDateString("en-ZA")}
                    {override.revokedAt ? " (withdrawn)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-xs text-[var(--muted)]">
          Assembled {pack.assembledAt.toLocaleString("en-ZA")} from the record.
        </p>
      </div>
    </AppShell>
  );
}
