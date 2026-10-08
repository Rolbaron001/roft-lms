import Link from "next/link";
import { localeFor, pageDates, requireSession, requireTenant } from "@/lib/request";
import { maybe, translator, type Translate } from "@/lib/i18n";
import { vocabulary } from "@/lib/terms";
import { myEnrolments } from "@/lib/enrolment";
import { listMyCertificates } from "@/lib/certificates";
import { listStatementsFor } from "@/lib/statement-of-results";
import { myLearningPaths } from "@/lib/learning-paths";
import { learnerQualifications } from "@/lib/learner-qualification";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { feedbackOwedBy } from "@/lib/feedback";
import { learnerBadges } from "@/lib/badges";
import { listAssessorQueue, listModerationQueue } from "@/lib/assessment";
import { adminDashboard } from "@/lib/dashboard";
import { PageNav } from "@/components/page-nav";
import { AdminDashboardView } from "./admin-dashboard";

function dueLabel(t: Translate, dueDate: Date | null, status: string): string | null {
  if (!dueDate || status === "completed") return null;

  const days = Math.ceil(
    (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (days < 0) {
    return Math.abs(days) === 1 ? t("home.overdueOne") : t("home.overdueMany", { days: Math.abs(days) });
  }
  if (days === 0) return t("home.dueToday");
  if (days === 1) return t("home.dueTomorrow");
  return t("home.dueIn", { days });
}

export default async function HomePage() {
  const tenant = await requireTenant();
  const session = await requireSession();
  // In the person's language (job sheet D9).
  const locale = localeFor(tenant, session);
  const t = translator(locale);
  const { day } = await pageDates();
  const date = (at: Date) => day(at);
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);

  // Feedback forms this person still owes. On the front page rather than behind
  // a notification, because a form nobody sees is a response rate nobody has.
  const owed = await feedbackOwedBy(session, session.userId);

  // Badges. On the front page rather than a profile nobody visits, because the
  // whole point is that recognition arrives on the day the work is finished
  // and is seen - formal certification is months away and the client has lost
  // learners in that gap.
  const earned = await learnerBadges(session, session.userId);
  // The Statement of Results is the document a learner is required to carry to
  // the external assessment, so the place they look for it is their own front
  // page. It was reachable only from the readiness screen, which is staff-side:
  // the learner could open their own statement but had no link that led there.
  const [enrolments, certificates, paths, statements] = await Promise.all([
    myEnrolments(session),
    listMyCertificates(session),
    myLearningPaths(session),
    listStatementsFor(session, session.userId),
  ]);

  // Courses reached through a programme are shown inside it, so they are not
  // listed twice under "My learning".
  const inAPath = new Set(
    paths.flatMap((path) => path.steps.map((step) => step.courseId)),
  );

  // Work waiting for this person, where their role gives them any. The queues
  // are in the menu and always were; the front page said nothing about them,
  // so an assessor signing in saw only their own learning. Found by the walk
  // of 26 September.
  const [toAssess, toModerate] = await Promise.all([
    session.permissions.includes("assessment:assess")
      ? listAssessorQueue(session).then((rows) => rows.length)
      : 0,
    session.permissions.includes("assessment:moderate")
      ? listModerationQueue(session).then((rows) => rows.length)
      : 0,
  ]);

  // A study unit is shown inside its qualification (Roland, 5 October 2026),
  // so it is not listed again on its own.
  const myQualifications = await learnerQualifications(session);
  const inAQualification = new Set(myQualifications.flatMap((one) => one.enrolmentIds));
  const standalone = enrolments.filter((row) => !inAPath.has(row.courseId) && !inAQualification.has(row.enrolmentId));
  const outstanding = standalone.filter((row) => row.status !== "completed");
  const finished = standalone.filter((row) => row.status === "completed");

  // An administrator opens on the provider's dashboard (job sheet D25). Their
  // own learning, if they have any, follows it.
  const isAdministrator = session.permissions.includes("tenant:manage_settings") && session.permissions.includes("enrolment:read_all");
  const dashboard = isAdministrator ? await adminDashboard(session, { leisaTargetHours: tenant.leisaTargetHours }) : null;
  const hasOwnLearning = standalone.length + paths.length + myQualifications.length + statements.length + certificates.length + earned.length > 0;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        {dashboard ? <p className="text-sm text-[var(--muted)]">{day(new Date())}</p> : null}
        <h1 className="text-xl font-semibold">
          {session.firstName} {session.lastName}
        </h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {session.roles.map((role) => (
            <span
              key={role}
              className="rounded-full px-3 py-1 text-xs font-medium text-white"
              style={{ background: "var(--brand-primary)" }}
            >
              {maybe(t, `role.${role}`) ?? role}
            </span>
          ))}
        </div>
      </div>

      {dashboard ? (
        <>
          <PageNav />
          <AdminDashboardView data={dashboard} t={t} day={day} />
        </>
      ) : null}

      <div className={dashboard ? (hasOwnLearning || owed.length > 0 ? "mt-10 space-y-6" : "hidden") : "space-y-6"}>
        {dashboard && (hasOwnLearning || owed.length > 0) ? <h2 className="text-lg font-semibold">{t("dash.ownLearning")}</h2> : null}
        {toAssess + toModerate > 0 && !dashboard ? (
          <Card title={t("home.waiting")}>
            <ul className="space-y-2 text-sm">
              {toAssess > 0 ? (
                <li>
                  <Link href="/assess" className="font-medium hover:underline">
                    {toAssess === 1 ? t("home.assessOne") : t("home.assessMany", { count: toAssess })}
                  </Link>
                </li>
              ) : null}
              {toModerate > 0 ? (
                <li>
                  <Link href="/moderate" className="font-medium hover:underline">
                    {toModerate === 1 ? t("home.moderateOne") : t("home.moderateMany", { count: toModerate })}
                  </Link>
                </li>
              ) : null}
            </ul>
          </Card>
        ) : null}

        {owed.length > 0 ? (
          <Card
            title={owed.length === 1 ? t("home.feedbackOne") : t("home.feedbackMany")}
            description={t("home.feedbackIntro")}
          >
            <ul className="space-y-2 text-sm">
              {owed.map((request) => (
                <li key={request.id}>
                  <Link
                    href={`/feedback/${request.id}`}
                    className="font-medium hover:underline"
                  >
                    {request.assessmentTitle ?? t("home.feedbackProgramme")}
                  </Link>
                  <span className="ml-2 text-[var(--muted)]">
                    {request.cohortName}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {earned.length > 0 ? (
          <Card
            title={t("home.earned")}
            description={t("home.earnedIntro")}
          >
            <ul className="flex flex-wrap gap-3">
              {earned.map((badge) => (
                <li
                  key={badge.id}
                  className="rounded-lg border border-[var(--border)] px-4 py-3"
                >
                  <p className="text-sm font-medium">
                    <span className="mr-2" aria-hidden>
                      {badge.glyph}
                    </span>
                    {badge.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {badge.earnedOn} · {badge.reference}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {paths.map((path) => (
          <Card key={path.enrolmentId} title={path.title}>
            {path.description ? (
              <p className="mb-4 text-sm text-[var(--muted)]">
                {path.description}
              </p>
            ) : null}

            <p className="mb-4 text-sm">
              <span className="font-medium">
                {t("home.pathFinished", { done: path.completedSteps, total: path.totalSteps })}
              </span>{" "}
              <span className="text-[var(--muted)]">
                {words.lowerMany("course")} {t("home.pathCourses")}
                {path.status === "completed" ? `: ${t("home.pathComplete")}` : ""}
              </span>
            </p>

            <ol className="space-y-2">
              {path.steps.map((step, index) => {
                const locked = step.state === "locked";
                const done = step.state === "completed";

                const inner = (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-3 text-sm">
                      <span
                        aria-hidden
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        style={
                          done
                            ? { background: "var(--success)", color: "white" }
                            : locked
                              ? {
                                  background: "var(--border)",
                                  color: "var(--muted)",
                                }
                              : {
                                  background: "var(--brand-primary)",
                                  color: "white",
                                }
                        }
                      >
                        {done ? "✓" : index + 1}
                      </span>
                      <span className={locked ? "text-[var(--muted)]" : ""}>
                        {step.title}
                      </span>
                    </span>

                    <span className="text-xs text-[var(--muted)]">
                      {done
                        ? t("home.step.finished")
                        : locked
                          ? index === 0
                            ? t("home.step.notStarted")
                            : t("home.step.afterPrevious")
                          : step.state === "in_progress"
                            ? t("home.step.inProgress")
                            : t("home.step.ready")}
                    </span>
                  </div>
                );

                return (
                  <li key={step.courseId}>
                    {step.enrolmentId ? (
                      <Link
                        href={`/learn/${step.enrolmentId}`}
                        className="block rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-3">
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>
        ))}

        {myQualifications.map((qualification) => {
          const completed = qualification.units.filter((unit) => unit.state === "completed").length;
          const next = qualification.units.find((unit) => unit.state === "in_progress" || unit.state === "open");
          return (
            <Card key={qualification.id} title={t("learnQual.myQualification")}>
              <Link href={`/learn/qualification/${qualification.id}`} className="text-lg font-semibold underline-offset-2 hover:underline">
                {qualification.title}
              </Link>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {[qualification.saqaId ? t("learnQual.saqa", { id: qualification.saqaId }) : null, qualification.cohortName].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-2 flex-1 rounded-full bg-[var(--border)]">
                  <div className="h-2 rounded-full bg-[var(--brand-accent)]" style={{ width: `${qualification.units.length ? Math.round((completed / qualification.units.length) * 100) : 0}%` }} />
                </div>
                <span className="shrink-0 text-xs text-[var(--muted)]">{t("learnQual.unitsDone", { done: completed, total: qualification.units.length })}</span>
              </div>
              <ul className="mt-4 divide-y divide-[var(--border)]">
                {qualification.units.map((unit) => (
                  <li key={unit.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                    <span>
                      <span className="font-medium">{unit.code}</span> {unit.title}
                    </span>
                    {unit.id === next?.id && unit.enrolmentId ? (
                      <Link href={`/learn/${unit.enrolmentId}`} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white" style={{ background: "var(--brand-primary)" }}>
                        {t("learnQual.continue")}
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">
                        {unit.state === "completed"
                          ? t("learnQual.state.completed")
                          : unit.state === "in_progress"
                            ? t("learnQual.state.inProgress", { done: unit.done, total: unit.total })
                            : unit.state === "open"
                              ? t("learnQual.state.open")
                              : unit.state === "waiting_cohort"
                                ? t("learnQual.state.waitingCohort")
                                : unit.state === "waiting_release"
                                  ? t("learnQual.state.waitingRelease")
                                  : t("learnQual.state.notEnrolled")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}

        <Card title={t("home.myLearning")}>
          {standalone.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {paths.length > 0 ? t("home.nothingOutside") : t("home.nothingYet")}
            </p>
          ) : (
            <div className="space-y-3">
              {[...outstanding, ...finished].map((enrolment) => {
                const percentage =
                  enrolment.totalLessons === 0
                    ? 0
                    : Math.round(
                        (enrolment.completedLessons / enrolment.totalLessons) *
                          100,
                      );
                const due = dueLabel(t, enrolment.dueDate, enrolment.status);
                const overdue = enrolment.status === "overdue";

                return (
                  <Link
                    key={enrolment.enrolmentId}
                    href={`/learn/${enrolment.enrolmentId}`}
                    className="block rounded-lg border border-[var(--border)] p-4 transition hover:border-[var(--brand-accent)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{enrolment.courseTitle}</p>
                        {due ? (
                          <p
                            className={`mt-0.5 text-xs ${
                              overdue
                                ? "font-medium text-[var(--danger)]"
                                : "text-[var(--muted)]"
                            }`}
                          >
                            {due}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge
                        status={enrolment.status}
                        label={maybe(t, `status.${enrolment.status}`) ?? undefined}
                      />
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <div
                        className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border)]"
                        role="progressbar"
                        aria-valuenow={percentage}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={t("home.progress", { title: enrolment.courseTitle })}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${percentage}%`,
                            background:
                              percentage === 100
                                ? "var(--success)"
                                : "var(--brand-accent)",
                          }}
                        />
                      </div>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {t("home.lessonsOf", { done: enrolment.completedLessons, total: enrolment.totalLessons })}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {statements.length > 0 ? (
          <Card
            title={t("home.statements")}
            description={t("home.statementsIntro")}
          >
            <ul className="space-y-2">
              {statements.map((statement) => (
                <li key={statement.id}>
                  <Link
                    href={`/statements/${statement.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{t("home.statement")}</span>
                      <span className="block font-mono text-xs text-[var(--muted)]">
                        {statement.verificationReference}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {statement.revokedAt ? (
                        <span className="font-medium text-[var(--danger)]">{t("home.withdrawn")}</span>
                      ) : (
                        t("home.issued", { date: date(statement.issuedAt) })
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {certificates.length > 0 ? (
          <Card title={t("home.certificates")}>
            <ul className="space-y-2">
              {certificates.map((certificate) => (
                <li key={certificate.id}>
                  <Link
                    href={`/certificates/${certificate.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]"
                  >
                    <span className="text-sm">
                      <span className="font-medium">{certificate.title}</span>
                      <span className="block font-mono text-xs text-[var(--muted)]">
                        {certificate.reference}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {certificate.revokedAt ? (
                        <span className="font-medium text-[var(--danger)]">{t("home.withdrawn")}</span>
                      ) : (
                        t("home.issued", { date: date(certificate.issuedAt) })
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
