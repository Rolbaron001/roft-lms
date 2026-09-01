import Link from "next/link";
import { notFound } from "next/navigation";
import { cohortAttendance, cohortSchedule } from "@/lib/scheduling";
import { cohortGrid, cohortTaskList, taskProgress } from "@/lib/tracker";
import { CohortTasks } from "./tasks";
import { Rollout } from "./rollout";
import { requirePermission, requireTenant } from "@/lib/request";
import { CohortError, getCohort } from "@/lib/cohorts";
import { blockedLearners } from "@/lib/spine";
import { listPeople } from "@/lib/people";
import { stepTimings } from "@/lib/programme-reports";
import { AppShell, Card } from "@/components/app-shell";
import {
  AddMember,
  RemoveMember,
  Reschedule,
  ScheduleEditor,
} from "./cohort-controls";

/**
 * One cohort: who is on it, what the schedule says, and who is stuck.
 *
 * The blocked list comes first deliberately. It is the only part a facilitator
 * has to act on today; the schedule and the register are reference.
 */
/**
 * The words the client already uses on this grid. "C" and "NYC" are theirs and
 * are read at a glance by people who have used them for years; spelling them
 * out would make the grid wider and no clearer.
 */
const GRID_LABEL: Record<string, string> = {
  not_started: "—",
  draft: "Started",
  submitted: "Submitted",
  competent: "C",
  not_yet_competent: "NYC",
  remediation: "Remediation",
  absent: "Absent",
  left: "Left",
};

export default async function CohortPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  let detail;
  try {
    detail = await getCohort(session, id);
  } catch (error) {
    if (error instanceof CohortError) notFound();
    throw error;
  }

  const blocked = await blockedLearners(session, detail.cohort.courseId);
  const active = detail.members.filter((member) => member.leftAt === null);

  const canManage = session.permissions.includes("enrolment:manage");
  const canSchedule = session.permissions.includes("session:manage");
  const canRegister = session.permissions.includes("attendance:record");

  const rollout = await cohortSchedule(session, detail.cohort.id);
  const attendance = await cohortAttendance(session, detail.cohort.id);
  const grid = await cohortGrid(session, detail.cohort.id);
  const tasks = await cohortTaskList(session, detail.cohort.id);

  const timings = await stepTimings(
    session,
    detail.cohort.id,
    detail.cohort.courseId,
  );
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
          ← Cohorts
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{detail.cohort.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Starts {detail.cohort.startDate} · {active.length}{" "}
          {active.length === 1 ? "learner" : "learners"}
        </p>
      </div>

      {canManage ? (
        <div className="mb-6">
          <Card
            title="Move the start"
            description="Every date below is held as a number of days from this one, so changing it moves the whole rollout for everybody on the cohort."
          >
            <Reschedule
              cohortId={detail.cohort.id}
              startDate={detail.cohort.startDate}
            />
          </Card>
        </div>
      ) : null}

      {blocked.length > 0 ? (
        <Card
          title={`Waiting on something (${blocked.length})`}
          description="Each learner once, at the earliest step they cannot open."
        >
          <ul className="space-y-2">
            {blocked.map((row) => (
              <li
                key={row.userId}
                className="rounded-md border border-[var(--border)] px-4 py-3 text-sm"
              >
                <span className="font-medium">
                  {row.firstName} {row.lastName}
                </span>
                <span className="mt-0.5 block">
                  Stuck at <strong>{row.stepTitle}</strong>
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">
                  Opens when {row.blockedBy.join("; and when ")}.
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {timings.some((row) => row.opened > 0) ? (
        <div className="mt-6">
          <Card
            title="Where the cohort has got to"
            description="Opened and finished per step, and how long it took those who finished. The median rather than the average, so one learner who disappeared for a term does not hide where everybody else is."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">Step</th>
                    <th className="pb-2">Opened</th>
                    <th className="pb-2">Finished</th>
                    <th className="pb-2">Still on it</th>
                    <th className="pb-2">Median days</th>
                    <th className="pb-2">Longest</th>
                  </tr>
                </thead>
                <tbody>
                  {timings.map((row) => (
                    <tr
                      key={row.stepId}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="py-2 pr-3">{row.title}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.opened}</td>
                      <td className="py-2 pr-3 tabular-nums">{row.completed}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {row.inProgress > 0 ? (
                          <strong>{row.inProgress}</strong>
                        ) : (
                          row.inProgress
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {row.medianDays === null ? "—" : row.medianDays}
                      </td>
                      <td className="py-2 tabular-nums">
                        {row.longestDays === null ? "—" : row.longestDays}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {stalled.length > 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                {stalled.length === 1
                  ? "One step has people sitting on it"
                  : `${stalled.length} steps have people sitting on them`}
                : {stalled.map((row) => row.title).join(", ")}.
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card
          title="Roll-out"
          description="The dated sessions this cohort meets for, and the register taken at each. Where a programme carries credits it has to be facilitator-led, and this is the evidence that it was."
        >
          <Rollout
            cohortId={detail.cohort.id}
            sessions={rollout}
            canManage={canSchedule}
            canRegister={canRegister}
          />
        </Card>
      </div>

      {attendance.countable > 0 ? (
        <div className="mt-6">
          <Card
            title="Attendance"
            description="Overall is against the whole programme; to date is against what has actually been held. Early in a programme the first is meaninglessly low and the second is the honest one, so both are given rather than one being chosen for you."
          >
            <p className="mb-3 text-sm text-[var(--muted)]">
              {attendance.held} of {attendance.countable} sessions held.
              Cancelled sessions and voluntary walk-ins are left out of both.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">Learner</th>
                    <th className="pb-2">Present</th>
                    <th className="pb-2">Absent</th>
                    <th className="pb-2">Excused</th>
                    <th className="pb-2">To date</th>
                    <th className="pb-2">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.learners.map((line) => (
                    <tr
                      key={line.userId}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="py-2 pr-3">{line.name}</td>
                      <td className="py-2 pr-3 tabular-nums">{line.present}</td>
                      <td className="py-2 pr-3 tabular-nums">{line.absent}</td>
                      <td className="py-2 pr-3 tabular-nums">{line.excused}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {line.toDatePercent}%
                      </td>
                      <td className="py-2 tabular-nums">
                        {line.overallPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {grid.assessments.length > 0 && grid.learners.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Assessment"
            description="Every learner against every piece of assessed work, in the order it is collected. Read from submissions, decisions and registers rather than kept by hand, so it cannot disagree with them."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2 pr-3">Learner</th>
                    {grid.assessments.map((column) => (
                      <th key={column.id} className="pb-2 pr-3">
                        <span className="block">{column.title}</span>
                        {column.dueOn ? (
                          <span className="block font-normal normal-case tabular-nums">
                            {column.dueOn}
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.learners.map((row) => (
                    <tr
                      key={row.userId}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {row.name}
                        {row.leftAt ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            left
                          </span>
                        ) : null}
                      </td>
                      {row.cells.map((cell) => (
                        <td
                          key={cell.assessmentId}
                          className="py-2 pr-3 whitespace-nowrap"
                          title={cell.on ?? undefined}
                        >
                          {GRID_LABEL[cell.status] ?? cell.status}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Absent is read from the register of the sitting the work was
              written at, not from the submission, because a learner who did
              not attend has no submission for it to be recorded on.
            </p>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card
          title="Work on this cohort"
          description="What has to happen around the teaching: material readied, documents submitted, a moderator appointed, certificates chased."
        >
          <CohortTasks
            cohortId={detail.cohort.id}
            tasks={tasks}
            progress={taskProgress(tasks)}
            canManage={canSchedule}
          />
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Course step release"
          description="Held as days from the start. Change the start date and every one of these moves with it."
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
              This cohort&rsquo;s course has no steps yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-2">Step</th>
                    <th className="pb-2">Opens</th>
                    <th className="pb-2">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.steps.map((step) => (
                    <tr key={step.id} className="border-t border-[var(--border)]">
                      <td className="py-2">{step.title ?? step.kind}</td>
                      <td className="py-2 tabular-nums">
                        {step.opensAt
                          ? step.opensAt.toISOString().slice(0, 10)
                          : "—"}
                        {step.opensAfterDays !== null ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            day {step.opensAfterDays}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 tabular-nums">
                        {step.dueAt
                          ? step.dueAt.toISOString().slice(0, 10)
                          : "—"}
                        {step.dueAfterDays !== null ? (
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            day {step.dueAfterDays}
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
          title={`On this cohort (${active.length})`}
          description="Adding somebody here also enrols them on the course. A name on a register who cannot open anything is the half-state this avoids."
        >
          {detail.members.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Nobody has been added yet.
            </p>
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
                        ? ` · left ${member.leftAt.toISOString().slice(0, 10)}`
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
