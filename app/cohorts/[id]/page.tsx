import Link from "next/link";
import { notFound } from "next/navigation";
import { cohortAttendance, cohortSchedule } from "@/lib/scheduling";
import { cohortGrid, cohortTaskList, taskProgress } from "@/lib/tracker";
import { CohortTasks } from "./tasks";
import { Rollout } from "./rollout";
import { Feedback } from "./feedback";
import { PaymentForm } from "./payment-form";
import { cohortFeedback, HOURS_TO_RESPOND } from "@/lib/feedback";
import { pageLocale, requirePermission, requireTenant, said } from "@/lib/request";
import { CohortError, getCohort } from "@/lib/cohorts";
import { blockedLearners } from "@/lib/spine";
import { listPeople } from "@/lib/people";
import { stepTimings } from "@/lib/programme-reports";
import { vocabulary } from "@/lib/terms";
import { maybe } from "@/lib/i18n/maybe";
import { Rich } from "@/components/rich-text";
import { AppShell, Card } from "@/components/app-shell";
import {
  AddMember,
  RemoveMember,
  ReleaseControls,
  RolloutImport,
  Reschedule,
  ScheduleEditor,
} from "./cohort-controls";

/**
 * One cohort: who is on it, what the schedule says, and who is stuck.
 *
 * The blocked list comes first deliberately. It is the only part a facilitator
 * has to act on today; the schedule and the register are reference.
 *
 * The assessment grid uses the client's own words, from the consolidated cohort
 * workbook they run today, kept short because these sit in grid cells: C and
 * NYC are what an assessor writes. They are in the catalogue like any other
 * phrase (cohort.grid.*), so a language that abbreviates differently can.
 */
export default async function CohortPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);

  let detail;
  try {
    detail = await getCohort(session, id);
  } catch (error) {
    if (error instanceof CohortError) notFound();
    throw error;
  }

  // Every course the cohort walks: one, or each study unit of a qualification.
  const blocked = await said(
    (await Promise.all(detail.courseIds.map((courseId) => blockedLearners(session, courseId)))).flat(),
  );
  const active = detail.members.filter((member) => member.leftAt === null);

  const canManage = session.permissions.includes("enrolment:manage");
  const canArchive = session.permissions.includes("records:manage");
  const canSchedule = session.permissions.includes("session:manage");
  const canRegister = session.permissions.includes("attendance:record");

  const rollout = await cohortSchedule(session, detail.cohort.id);
  const attendance = await cohortAttendance(session, detail.cohort.id);
  const grid = await cohortGrid(session, detail.cohort.id);

  // Feedback is a tenant-level report rather than an enrolment one: it is read
  // by whoever runs the programme, and asked for by whoever schedules it.
  const canReadReports = session.permissions.includes("report:tenant");
  const feedbackRequests = canReadReports
    ? await cohortFeedback(session, detail.cohort.id)
    : [];
  const tasks = await cohortTaskList(session, detail.cohort.id);

  const timings = (
    await Promise.all(detail.courseIds.map((courseId) => stepTimings(session, detail.cohort.id, courseId)))
  ).flat();
  const stalled = timings.filter((row) => row.inProgress > 0);

  // Only somebody who can change the register needs the list of who could join
  // it, and listPeople asks for a permission a read-only viewer may not hold.
  const onCohort = new Set(active.map((member) => member.userId));
  const candidates = canManage
    ? (await listPeople(session)).filter(
        (person) =>
          person.status === "active" &&
          person.roles.includes("learner") &&
          !onCohort.has(person.id),
      )
    : [];

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/cohorts" className="text-sm text-[var(--muted)] hover:underline">
          {t("cohort.back", { cohorts: words.many("cohort") })}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{detail.cohort.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t("cohort.starts", { date: detail.cohort.startDate })} ·{" "}
          {active.length === 1
            ? t("cohort.oneLearner", { learner: words.lowerOne("learner") })
            : t("cohort.learners", { count: active.length, learners: words.lowerMany("learner") })}
          {canArchive ? (
            <>
              {" · "}
              <Link href={`/cohorts/${detail.cohort.id}/archive`} className="hover:underline">
                {t("cohort.archive")}
              </Link>
            </>
          ) : null}
        </p>
        {detail.qualificationTitle ? (
          <p className="mt-1 text-sm text-[var(--muted)]">{t("cohort.walksQualification", { qualification: detail.qualificationTitle })}</p>
        ) : null}
        {detail.cohort.releaseMode === "open" ? (
          <p className="mt-1 text-sm text-[var(--muted)]">{t("cohort.openAll")}</p>
        ) : null}
      </div>

      {/*
        The opening step of the enrolment procedure: "once the client has been
        invoiced and proof of payment has been received". Shown here because
        that payment covers the whole cohort - a learner paying their own way
        supplies a proof of payment against themselves instead, and either
        satisfies it.
      */}
      {canManage ? (
        <div className="mb-6">
          <Card
            title={t("cohort.payment")}
            description={
              detail.cohort.paymentReceivedAt
                ? detail.cohort.paymentReference
                  ? t("cohort.paidRef", { reference: detail.cohort.paymentReference })
                  : t("cohort.paid")
                : detail.cohort.invoicedAt
                  ? t("cohort.invoiced")
                  : t("cohort.nothingRecorded")
            }
          >
            <PaymentForm
              cohortId={detail.cohort.id}
              invoicedAt={detail.cohort.invoicedAt}
              paymentReceivedAt={detail.cohort.paymentReceivedAt}
              reference={detail.cohort.paymentReference}
            />
          </Card>
        </div>
      ) : null}

      {canManage ? (
        <div className="mb-6">
          <Card title={t("cohort.move")} description={t("cohort.moveIntro")}>
            <Reschedule cohortId={detail.cohort.id} startDate={detail.cohort.startDate} />
          </Card>
        </div>
      ) : null}

      {blocked.length > 0 ? (
        <Card title={t("cohort.waiting", { count: blocked.length })} description={t("cohort.waitingIntro")}>
          <ul className="space-y-2">
            {blocked.map((row) => (
              <li key={row.userId} className="rounded-md border border-[var(--border)] px-4 py-3 text-sm">
                <span className="font-medium">
                  {row.firstName} {row.lastName}
                </span>
                <span className="mt-0.5 block">
                  <Rich text={t("cohort.stuckAt")} parts={{ step: <strong>{row.stepTitle}</strong> }} />
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{row.blockedBy.join(" ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {timings.some((row) => row.opened > 0) ? (
        <div className="mt-6">
          <Card title={t("cohort.progress")} description={t("cohort.progressIntro")}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">{t("cohort.step")}</th>
                    <th className="pb-2">{t("cohort.opened")}</th>
                    <th className="pb-2">{t("cohort.finished")}</th>
                    <th className="pb-2">{t("cohort.stillOn")}</th>
                    <th className="pb-2">{t("cohort.median")}</th>
                    <th className="pb-2">{t("cohort.longest")}</th>
                  </tr>
                </thead>
                <tbody>
                  {timings.map((row) => (
                    <tr key={row.stepId} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-3">{row.title}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.opened}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.completed}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {row.inProgress > 0 ? <strong>{row.inProgress}</strong> : row.inProgress}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{row.medianDays === null ? "—" : row.medianDays}</td>
                      <td className="py-2 tabular-nums">{row.longestDays === null ? "—" : row.longestDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {stalled.length > 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                {stalled.length === 1
                  ? t("cohort.stalledOne", { steps: stalled.map((row) => row.title).join(", ") })
                  : t("cohort.stalledMany", {
                      count: stalled.length,
                      steps: stalled.map((row) => row.title).join(", "),
                    })}
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card title={t("cohort.rollout")} description={t("cohort.rolloutIntro")}>
          <Rollout
            zone={tenant.timezone}
            cohortId={detail.cohort.id}
            sessions={rollout}
            canManage={canSchedule}
            canRegister={canRegister}
          />
        </Card>
      </div>

      {attendance.countable > 0 ? (
        <div className="mt-6">
          <Card title={t("cohort.attendance")} description={t("cohort.attendanceIntro")}>
            <p className="mb-3 text-sm text-[var(--muted)]">
              {t("cohort.held", { held: attendance.held, countable: attendance.countable })}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">{words.one("learner")}</th>
                    <th className="pb-2">{t("cohort.present")}</th>
                    <th className="pb-2">{t("cohort.absent")}</th>
                    <th className="pb-2">{t("cohort.excused")}</th>
                    <th className="pb-2">{t("cohort.toDate")}</th>
                    <th className="pb-2">{t("cohort.overall")}</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.learners.map((line) => (
                    <tr key={line.userId} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-3">{line.name}</td>
                      <td className="py-2 pr-3 tabular-nums">{line.present}</td>
                      <td className="py-2 pr-3 tabular-nums">{line.absent}</td>
                      <td className="py-2 pr-3 tabular-nums">{line.excused}</td>
                      <td className="py-2 pr-3 tabular-nums">{line.toDatePercent}%</td>
                      <td className="py-2 tabular-nums">{line.overallPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {canReadReports ? (
        <div className="mt-6">
          <Card
            title={t("cohort.feedback", { programme: words.one("programme") })}
            description={t("cohort.feedbackIntro", { hours: HOURS_TO_RESPOND })}
          >
            <Feedback
              cohortId={detail.cohort.id}
              zone={tenant.timezone}
              assessments={grid.assessments.map((column) => ({
                id: column.id,
                title: column.title,
              }))}
              requests={feedbackRequests}
              canAsk={canManage}
            />
          </Card>
        </div>
      ) : null}

      {grid.assessments.length > 0 && grid.learners.length > 0 ? (
        <div className="mt-6">
          <Card title={t("cohort.assessment")} description={t("cohort.assessmentIntro")}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2 pr-3">{words.one("learner")}</th>
                    {grid.assessments.map((column) => (
                      <th key={column.id} className="pb-2 pr-3">
                        <span className="block">{column.title}</span>
                        {column.dueOn ? (
                          <span className="block font-normal normal-case tabular-nums">{column.dueOn}</span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.learners.map((row) => (
                    <tr key={row.userId} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.name}
                        {row.leftAt ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">{t("cohort.left")}</span>
                        ) : null}
                      </td>
                      {row.cells.map((cell) => (
                        <td
                          key={cell.assessmentId}
                          className="py-2 pr-3 whitespace-nowrap"
                          title={cell.on ?? undefined}
                        >
                          {cell.status === "not_started"
                            ? "—"
                            : (maybe(t, `cohort.grid.${cell.status}`) ?? cell.status)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">{t("cohort.absentNote")}</p>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card title={t("cohort.work")} description={t("cohort.workIntro")}>
          <CohortTasks
            cohortId={detail.cohort.id}
            tasks={tasks}
            progress={taskProgress(tasks)}
            canManage={canSchedule}
          />
        </Card>
      </div>

      {canManage && detail.steps.length > 0 && detail.cohort.releaseMode !== "open" ? (
        <div className="mt-6">
          <Card title={t("rolloutImport.title")} description={t("rolloutImport.intro")}>
            <RolloutImport cohortId={detail.cohort.id} />
          </Card>
        </div>
      ) : null}

      {canManage && detail.steps.length > 0 && detail.cohort.releaseMode !== "open" ? (
        <div className="mt-6">
          <Card title={t("cohort.reachTitle")} description={t("cohort.reachIntro")}>
            <ReleaseControls
              cohortId={detail.cohort.id}
              steps={detail.steps.map((step) => ({
                id: step.id,
                title: step.title,
                kind: step.kind,
                released: step.released,
                releasedAt: step.releasedAt,
                opensAt: step.opensAt,
              }))}
            />
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card
          title={t("cohort.release", { course: words.one("course") })}
          description={t("cohort.releaseIntro")}
        >
          {canManage ? (
            <ScheduleEditor
              cohortId={detail.cohort.id}
              startDate={detail.cohort.startDate}
              steps={detail.steps.map((step) => ({
                id: step.id,
                title: step.title,
                kind: step.kind,
                opensAfterDays: step.opensAfterDays,
                dueAfterDays: step.dueAfterDays,
                closesAfterDays: step.closesAfterDays,
              }))}
            />
          ) : detail.steps.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              {t("cohort.noSteps", { course: words.lowerOne("course") })}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">{t("cohort.step")}</th>
                    <th className="pb-2">{t("cohort.opens")}</th>
                    <th className="pb-2">{t("cohort.due")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.steps.map((step) => (
                    <tr key={step.id} className="border-t border-[var(--border)]">
                      <td className="py-2">{step.title ?? step.kind}</td>
                      <td className="py-2 tabular-nums">
                        {step.opensAt ? step.opensAt.toISOString().slice(0, 10) : "—"}
                        {step.opensAfterDays !== null ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {t("cohort.day", { day: step.opensAfterDays })}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 tabular-nums">
                        {step.dueAt ? step.dueAt.toISOString().slice(0, 10) : "—"}
                        {step.dueAfterDays !== null ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            {t("cohort.day", { day: step.dueAfterDays })}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title={t("cohort.members", { count: active.length })}
          description={t("cohort.membersIntro", { course: words.lowerOne("course") })}
        >
          {detail.members.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("cohort.nobody")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {detail.members.map((member) => (
                <li
                  key={member.userId}
                  className={`flex flex-wrap items-center justify-between gap-2 ${
                    member.leftAt ? "opacity-60" : ""
                  }`}
                >
                  <span>
                    {member.firstName} {member.lastName}
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      {member.email}
                      {member.leftAt
                        ? t("cohort.leftOn", { date: member.leftAt.toISOString().slice(0, 10) })
                        : ""}
                    </span>
                  </span>
                  {canManage && !member.leftAt ? (
                    <RemoveMember
                      cohortId={detail.cohort.id}
                      userId={member.userId}
                      name={`${member.firstName} ${member.lastName}`}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <AddMember
                cohortId={detail.cohort.id}
                candidates={candidates.map((person) => ({
                  id: person.id,
                  firstName: person.firstName,
                  lastName: person.lastName,
                  email: person.email,
                }))}
              />
            </div>
          ) : null}
        </Card>
      </div>
    </AppShell>
  );
}
