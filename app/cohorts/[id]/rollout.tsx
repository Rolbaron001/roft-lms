"use client";

import Link from "next/link";
import { useActionState } from "react";
import { scheduleSessionAction } from "@/app/cohorts/actions";
import type { CohortActionState } from "@/app/cohorts/actions";
import type { ScheduledSession } from "@/lib/scheduling";
import { ProviderClockNote } from "@/components/zoned-time";

const KIND_LABEL: Record<string, string> = {
  induction: "Induction",
  lecture: "Lecture",
  revision: "Revision",
  summative: "Summative",
  mock_eisa: "Mock EISA",
  workplace_induction: "Workplace induction",
  walk_in: "Walk-in",
};

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

/**
 * The roll-out: dated lectures, in the order they happen.
 *
 * It shows what each session covers, whether it has been held, and how far
 * through its register is, because the question a coordinator asks of a
 * schedule is rarely "what is on it" and almost always "what has not been done
 * yet".
 */
export function Rollout({
  cohortId,
  zone,
  sessions,
  canManage,
  canRegister,
}: {
  cohortId: string;
  /** The provider's clock. Every time in the timetable is on it. */
  zone: string;
  sessions: ScheduledSession[];
  canManage: boolean;
  canRegister: boolean;
}) {
  const [state, action, pending] = useActionState<CohortActionState, FormData>(
    scheduleSessionAction,
    {},
  );

  return (
    <div className="space-y-6">
      {sessions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Nothing scheduled yet. Where a programme carries credits it has to
          be facilitator-led, so this is where the evidence that it was begins.
        </p>
      ) : (
        <div>
          <ProviderClockNote zone={zone} />
          <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="pb-2">#</th>
                <th className="pb-2">Date</th>
                <th className="pb-2">Session</th>
                <th className="pb-2">Covers</th>
                <th className="pb-2">Workbooks</th>
                <th className="pb-2">Register</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((entry) => (
                <tr key={entry.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3 tabular-nums text-[var(--muted)]">
                    {entry.sequence ?? "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                    {entry.scheduledDate}
                    {entry.startTime ? (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {entry.startTime}
                        {entry.endTime ? `–${entry.endTime}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {entry.title ?? KIND_LABEL[entry.kind] ?? entry.kind}
                    {entry.status !== "scheduled" ? (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {entry.status}
                        {entry.statusNote ? `: ${entry.statusNote}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-[var(--muted)]">
                    {entry.studyUnitCode ?? entry.moduleCode ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-xs text-[var(--muted)]">
                    {entry.workbooks.length === 0
                      ? "—"
                      : entry.workbooks
                          .map((w) => `${w.role}: ${w.title}`)
                          .join(", ")}
                  </td>
                  <td className="py-2 tabular-nums">
                    {entry.status === "cancelled" ? (
                      <span className="text-[var(--muted)]">—</span>
                    ) : canRegister ? (
                      <Link
                        href={`/cohorts/${cohortId}/sessions/${entry.id}`}
                        className="hover:underline"
                      >
                        {entry.register.marked}/{entry.register.expected}
                      </Link>
                    ) : (
                      <span>
                        {entry.register.marked}/{entry.register.expected}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {canManage ? (
        <form
          action={action}
          className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3"
        >
          <input type="hidden" name="cohortId" value={cohortId} />

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Date</span>
            <input
              name="scheduledDate"
              type="date"
              required
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Kind</span>
            <select name="kind" defaultValue="lecture" className={inputClass}>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Lecture number{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input
              name="sequence"
              type="number"
              min={1}
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Starts</span>
            <input
              name="startTime"
              placeholder="18:30"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Ends</span>
            <input name="endTime" placeholder="20:30" className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Delivery</span>
            <select
              name="deliveryMode"
              defaultValue="virtual"
              className={inputClass}
            >
              <option value="virtual">Virtual</option>
              <option value="in_person">In person</option>
              <option value="blended">Blended</option>
            </select>
          </label>

          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">
              Meeting link{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input
              name="meetingUrl"
              type="url"
              placeholder="https://…"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Title{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input name="title" className={inputClass} />
          </label>

          <div className="sm:col-span-3">
            {state.error ? (
              <p className="mb-2 text-sm text-[var(--danger,#b00020)]">
                {state.error}
              </p>
            ) : null}
            {state.done ? (
              <p className="mb-2 text-sm text-[var(--muted)]">{state.done}</p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Adding…" : "Add to the schedule"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
