import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { cohortsForLearner, learnerAppeals, notesForLearner, resultsToAppeal } from "@/lib/appeals";
import { learnerGrievances } from "@/lib/conduct";
import { maybe } from "@/lib/i18n";
import { AppShell, Card } from "@/components/app-shell";
import { AppealConductForm, AppealResultForm, ConcernForm } from "./forms";

/**
 * A learner's own appeals and concerns (Roland, 12 October 2026). Until then
 * a learner held the right to lodge both and had no screen to do it from: a
 * coordinator had to take it down for them.
 */
export default async function MyAppealsPage({ searchParams }: { searchParams: Promise<{ assessment?: string }> }) {
  const tenant = await requireTenant();
  const session = await requirePermission("appeal:lodge");
  const { t, day, when } = await pageLocale();
  const { assessment } = await searchParams;

  const [results, cohorts, appeals, grievances] = await Promise.all([
    resultsToAppeal(session, tenant.timezone),
    cohortsForLearner(session, session.userId),
    learnerAppeals(session, session.userId),
    learnerGrievances(session, session.userId),
  ]);
  const notes = await notesForLearner(session, appeals.map((appeal) => appeal.id));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("myAppeals.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("myAppeals.intro")}</p>
      </div>

      <div className="space-y-6">
        <Card title={t("myAppeals.yourAppeals")}>
          {appeals.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("myAppeals.noAppeals")}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {appeals.map((appeal) => (
                <li key={appeal.id} id={`appeal-${appeal.id}`} className="space-y-1 py-3">
                  <p className="font-medium">
                    {appeal.assessmentTitle ?? maybe(t, `appeals.ground.${appeal.ground}`) ?? appeal.ground}
                    <span className="ml-2 rounded-full bg-[var(--surface-muted,#f1f5f9)] px-2 py-0.5 text-xs font-normal">
                      {maybe(t, `appeals.status.${appeal.status}`) ?? appeal.status}
                    </span>
                  </p>
                  <p className="text-[var(--muted)]">
                    {t("myAppeals.lodgedOn", { date: when(appeal.lodgedAt) })}
                    {appeal.acknowledgedAt ? ` · ${t("myAppeals.acknowledgedOn", { date: when(appeal.acknowledgedAt) })}` : ""}
                  </p>
                  {appeal.outcome ? (
                    <div className="mt-1 rounded-md border border-[var(--border)] p-3">
                      <p className="font-medium">{t("myAppeals.outcomeIs", { outcome: maybe(t, `appeals.outcome.${appeal.outcome}`) ?? appeal.outcome })}</p>
                      {appeal.outcomeReason ? <p className="mt-1 whitespace-pre-line">{appeal.outcomeReason}</p> : null}
                    </div>
                  ) : null}
                  {(notes[appeal.id] ?? []).map((note, index) => (
                    <p key={index} className="text-[var(--muted)]">
                      {day(note.createdAt)}: {note.note}
                    </p>
                  ))}
                  {appeal.withdrawnReason ? <p className="text-[var(--muted)]">{t("myAppeals.withdrawn", { reason: appeal.withdrawnReason })}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("myAppeals.yourConcerns")}>
          {grievances.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("myAppeals.noConcerns")}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {grievances.map((grievance) => (
                <li key={grievance.id} className="space-y-1 py-3">
                  <p className="font-medium">
                    {grievance.nature.length > 90 ? `${grievance.nature.slice(0, 90)}…` : grievance.nature}
                    <span className="ml-2 rounded-full bg-[var(--surface-muted,#f1f5f9)] px-2 py-0.5 text-xs font-normal">
                      {maybe(t, `grievance.status.${grievance.status}`) ?? grievance.status}
                    </span>
                  </p>
                  <p className="text-[var(--muted)]">
                    {t("myAppeals.lodgedOn", { date: day(grievance.lodgedOn) })}
                    {grievance.acknowledgedAt ? ` · ${t("myAppeals.acknowledgedOn", { date: when(grievance.acknowledgedAt) })}` : ` · ${t("myAppeals.ackBy", { date: day(grievance.acknowledgeBy) })}`}
                  </p>
                  {grievance.decision ? (
                    <div className="mt-1 rounded-md border border-[var(--border)] p-3">
                      <p className="font-medium">{t("myAppeals.decision")}</p>
                      <p className="mt-1 whitespace-pre-line">{grievance.decision}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("myAppeals.appealResult")} description={t("myAppeals.appealResultIntro")}>
          {cohorts.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("myAppeals.noCohort")}</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("myAppeals.noResults")}</p>
          ) : (
            <AppealResultForm results={results} cohorts={cohorts} preselect={assessment ?? null} />
          )}
        </Card>

        <Card title={t("myAppeals.appealConduct")} description={t("myAppeals.appealConductIntro")}>
          {cohorts.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("myAppeals.noCohort")}</p>
          ) : (
            <AppealConductForm cohorts={cohorts} />
          )}
        </Card>

        <Card title={t("myAppeals.raiseConcern")} description={t("myAppeals.raiseConcernIntro")}>
          <ConcernForm />
        </Card>
      </div>
    </AppShell>
  );
}
