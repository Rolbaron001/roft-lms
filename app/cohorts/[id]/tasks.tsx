"use client";

import { useActionState } from "react";
import {
  addCohortTaskAction,
  setTaskStatusAction,
  type CohortActionState,
} from "@/app/cohorts/actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

const STATUS_LABEL: Record<string, string> = {
  not_yet_started: "Not yet started",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
  postponed: "Postponed",
};

export type CohortTask = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeFirst: string | null;
  assigneeLast: string | null;
};

/**
 * The work of running a cohort, as opposed to the teaching of it.
 *
 * Deliberately thin. This is the one sheet per cohort the client keeps by
 * hand, given somewhere to live next to the cohort it describes; it is not a
 * project management tool and should not become one.
 */
export function CohortTasks({
  cohortId,
  tasks,
  progress,
  canManage,
}: {
  cohortId: string;
  tasks: CohortTask[];
  progress: { complete: number; counted: number; percent: number | null };
  canManage: boolean;
}) {
  const [addState, addAction, adding] = useActionState<
    CohortActionState,
    FormData
  >(addCohortTaskAction, {});
  const [statusState, statusAction] = useActionState<
    CohortActionState,
    FormData
  >(setTaskStatusAction, {});

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        {progress.percent === null
          ? "Nothing tracked yet."
          : `${progress.complete} of ${progress.counted} done — ${progress.percent}%. Cancelled work is left out of both halves, so abandoning a task neither helps nor hurts the figure.`}
      </p>

      {tasks.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="pb-2">Task</th>
                <th className="pb-2">Assigned</th>
                <th className="pb-2">Due</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3">
                    {task.name}
                    {task.description ? (
                      <span className="block text-xs text-[var(--muted)]">
                        {task.description}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-[var(--muted)]">
                    {task.assigneeFirst
                      ? `${task.assigneeFirst} ${task.assigneeLast}`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                    {task.dueDate ?? "—"}
                  </td>
                  <td className="py-2">
                    {canManage ? (
                      <form action={statusAction} className="flex gap-2">
                        <input type="hidden" name="cohortId" value={cohortId} />
                        <input type="hidden" name="taskId" value={task.id} />
                        <select
                          name="status"
                          defaultValue={task.status}
                          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                        >
                          {Object.entries(STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                        >
                          Set
                        </button>
                      </form>
                    ) : (
                      (STATUS_LABEL[task.status] ?? task.status)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {statusState.error ? (
        <p className="text-sm text-[var(--danger,#b00020)]">
          {statusState.error}
        </p>
      ) : null}

      {canManage ? (
        <form
          action={addAction}
          className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-4"
        >
          <input type="hidden" name="cohortId" value={cohortId} />

          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">Task</span>
            <input name="name" required minLength={2} className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Starts</span>
            <input name="startDate" type="date" className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Due</span>
            <input name="dueDate" type="date" className={inputClass} />
          </label>

          <label className="block space-y-1.5 sm:col-span-4">
            <span className="block text-sm font-medium">
              Note{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input name="description" className={inputClass} />
          </label>

          <div className="sm:col-span-4">
            {addState.error ? (
              <p className="mb-2 text-sm text-[var(--danger,#b00020)]">
                {addState.error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={adding}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add task"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
