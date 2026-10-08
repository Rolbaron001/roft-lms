import Link from "next/link";
import { pageLocale, requireSession, requireTenant, said } from "@/lib/request";
import { vocabulary } from "@/lib/terms";
import { qualificationReadiness } from "@/lib/eisa";
import {
  listStatementsFor,
  studyUnitsForStatements,
} from "@/lib/statement-of-results";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell, Card } from "@/components/app-shell";
import { PageNav } from "@/components/page-nav";
import { IssueStatement } from "./issue";
import { QualificationAward } from "./award";
import { awardsFor } from "@/lib/qualification-awards";

/**
 * One learner against one qualification, down to the criterion.
 *
 * This is what a moderator or external verifier asks to see, so it shows the
 * criterion codes exactly as the curriculum document numbers them rather than
 * a friendlier paraphrase.
 */
export default async function LearnerReadinessPage({
  params,
}: {
  params: Promise<{ qualificationId: string; userId: string }>;
}) {
  const { qualificationId, userId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, locale, dates } = await pageLocale();
  // Curiosa say "workplace experience sign-off" rather than "logbook", and
  // another provider says the opposite. The word is the tenant's to choose.
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const record = words.lowerOne("workplaceRecord");

  const formatDate = (value: Date | null): string =>
    value
      ? value.toLocaleDateString(dates, { day: "numeric", month: "short", year: "numeric" })
      : "—";

  // The permission check lives in the engine: a learner may see their own,
  // anybody else needs enrolment:read_all.
  const readiness = await said(await qualificationReadiness(session, qualificationId, userId));
  const isSelf = readiness.learner.userId === session.userId;

  const statements = await listStatementsFor(session, userId);
  // The live statement for one scope: the whole qualification when the study
  // unit is null. Until 26 September this matched any statement for the
  // qualification, so a unit's statement would have been shown as the whole
  // qualification's and hidden the button for it.
  const liveFor = (studyUnitId: string | null) =>
    statements.find(
      (statement) =>
        statement.qualificationId === qualificationId &&
        statement.studyUnitId === studyUnitId &&
        !statement.revokedAt,
    );
  const current = liveFor(null);
  const units = await studyUnitsForStatements(session, qualificationId);
  const canIssue = session.permissions.includes("certificate:issue");
  const canManageAwards = session.permissions.includes("enrolment:manage");
  const awards = await awardsFor(session, userId);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        {!isSelf ? (
          <Link
            href="/readiness"
            className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
          >
            {t("ready.all")}
          </Link>
        ) : null}
        <h1 className="mt-2 text-xl font-semibold">
          {isSelf
            ? t("ready.yours")
            : `${readiness.learner.firstName} ${readiness.learner.lastName}`}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {readiness.qualificationTitle}
          {readiness.saqaId ? ` · SAQA ${readiness.saqaId}` : ""}
        </p>
      </div>

      <PageNav />

      <section
        id="summary"
        data-page-section={t("ready.nav.summary")}
        className="mb-6 scroll-mt-28 rounded-lg border-2 bg-[var(--surface)] p-6"
        style={{
          borderColor: readiness.eisaEligible ? "var(--success)" : "var(--border)",
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <p
              className="text-lg font-semibold"
              style={{ color: readiness.eisaEligible ? "var(--success)" : undefined }}
            >
              {readiness.eisaEligible ? t("ready.isEligible") : t("ready.notEligible")}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {t("ready.achieved", {
                achieved: readiness.achievedCriteria,
                total: readiness.totalCriteria,
                record,
              })}{" "}
              {readiness.eisaEligible ? t("ready.canIssue") : t("ready.everyOne")}
            </p>

            {/* Offered whether or not the learner is eligible. The engine
                refuses and names what is missing, which is more useful than a
                button that silently is not there - and it closes the gap
                between the page being rendered and the button being pressed. */}
            {canIssue ? (
              <IssueStatement
                qualificationId={qualificationId}
                userId={userId}
                existing={
                  current
                    ? { id: current.id, reference: current.verificationReference }
                    : null
                }
              />
            ) : null}

            {!canIssue && current ? (
              <p className="mt-3 text-sm">
                <Link href={`/statements/${current.id}`} className="underline underline-offset-2">
                  {t("ready.yourStatement")}
                </Link>
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums">{readiness.readinessIndex}%</p>
            <p className="text-xs text-[var(--muted)]">{t("ready.weighted")}</p>
          </div>
        </div>
      </section>

      {units.length > 0 && (canIssue || units.some((unit) => liveFor(unit.id))) ? (
        <div className="mb-6">
          <Card section={{ id: "units", label: t("ready.nav.units") }} title={t("ready.perUnit")} description={t("ready.perUnitIntro")}>
            <ul className="space-y-3">
              {units.map((unit) => {
                const held = liveFor(unit.id);
                return (
                  <li key={unit.id} className="text-sm">
                    <span className="font-medium">
                      {unit.code} {unit.title}
                    </span>
                    {canIssue ? (
                      <IssueStatement
                        qualificationId={qualificationId}
                        userId={userId}
                        studyUnit={{ id: unit.id, code: unit.code }}
                        existing={
                          held ? { id: held.id, reference: held.verificationReference } : null
                        }
                      />
                    ) : held ? (
                      <p className="mt-1">
                        <Link href={`/statements/${held.id}`} className="underline underline-offset-2">
                          {t("ready.unitStatement", { unit: unit.code })}
                        </Link>
                      </p>
                    ) : (
                      <p className="mt-1 text-[var(--muted)]">{t("ready.notIssued")}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ) : null}

      <div className="mb-6">
        <Card
          section={{ id: "certificate", label: t("ready.nav.certificate") }}
          title={t("ready.certificate")}
          description={t("ready.certificateIntro", { provider: tenant.displayName })}
        >
          <QualificationAward
            qualificationId={qualificationId}
            userId={userId}
            canManage={canManageAwards}
            award={awards.find((award) => award.qualificationId === qualificationId) ?? null}
          />
        </Card>
      </div>

      {!readiness.curriculumComplete ? (
        <div className="mb-6 rounded-lg border-2 p-4" style={{ borderColor: "var(--danger)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
            {t("ready.thisNotCaptured")}
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("ready.thisNotCapturedIntro", { modules: readiness.modulesWithoutCriteria.join(", ") })}
          </p>
        </div>
      ) : null}

      <p className="mb-4 text-xs text-[var(--muted)]">
        {t("ready.weightedBy", {
          how: maybe(t, `ready.weight.${readiness.weightSource}`) ?? readiness.weightSource,
        })}
      </p>

      {readiness.components
        .filter((component) => component.modules.length > 0)
        .map((component) => (
          <section
            key={component.component}
            id={`component-${component.component}`}
            data-page-section={maybe(t, `ready.component.${component.component}`) ?? component.component}
            className="mb-6 scroll-mt-28"
          >
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-semibold">
                {maybe(t, `ready.component.${component.component}`) ?? component.component}
              </h2>
              <p className="text-sm text-[var(--muted)] tabular-nums">
                {t("ready.share", {
                  weight: Math.round(component.weight * 100),
                  percent: component.percent,
                })}
              </p>
            </div>

            <div className="space-y-3">
              {component.modules.map((module) => (
                <Card key={module.moduleId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-medium">{module.title}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {module.code}
                        {module.credits ? ` · ${t("ready.credits", { credits: module.credits })}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="tabular-nums">
                        {module.route === "logbook"
                          ? words.one("workplaceRecord")
                          : t("ready.criteriaOf", {
                              achieved: module.achievedCount,
                              total: module.totalCount,
                            })}
                      </p>
                      {module.complete ? (
                        <p className="text-xs" style={{ color: "var(--success)" }}>
                          {t("ready.competentOn", { date: formatDate(module.competenceAchievedAt) })}
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--muted)] tabular-nums">{module.percent}%</p>
                      )}
                    </div>
                  </div>

                  {module.route === "logbook" ? (
                    <div className="mt-3 text-sm">
                      <p className="text-[var(--muted)]">{t("ready.workProved", { record })}</p>
                      {module.logbook ? (
                        <p className="mt-2">
                          <Link
                            href={`/workplace/${module.logbook.id}`}
                            className="underline underline-offset-2"
                          >
                            {t("ready.openRecord", { record })}
                          </Link>
                          {module.logbook.coachSignedAt
                            ? t("ready.coachSigned", { date: formatDate(module.logbook.coachSignedAt) })
                            : ""}
                        </p>
                      ) : (
                        <p className="mt-2" style={{ color: "var(--danger)" }}>
                          {t("ready.noRecord", { record })}
                        </p>
                      )}
                    </div>
                  ) : module.totalCount === 0 ? (
                    <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
                      {t("ready.noCriteria")}
                    </p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {module.topics.map((topic) => (
                        <div key={topic.topicId ?? topic.code}>
                          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                            {t("ready.topicShare", {
                              code: topic.code,
                              title: topic.title,
                              weight: Math.round(topic.weight * 100),
                            })}
                          </p>
                          <ul className="mt-2 space-y-1">
                            {topic.criteria.map((criterion) => (
                              <li key={criterion.criterionId} className="flex gap-2 text-sm">
                                <span
                                  aria-hidden
                                  style={{
                                    color: criterion.achieved ? "var(--success)" : "var(--muted)",
                                  }}
                                >
                                  {criterion.achieved ? "✓" : "○"}
                                </span>
                                <span className="font-mono text-xs text-[var(--muted)]">
                                  {criterion.code}
                                </span>
                                <span className={criterion.achieved ? "" : "text-[var(--muted)]"}>
                                  {criterion.description}
                                </span>
                                {criterion.achievedAt ? (
                                  <span className="ml-auto whitespace-nowrap text-xs text-[var(--muted)]">
                                    {formatDate(criterion.achievedAt)}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>
        ))}
    </AppShell>
  );
}
