"use client";

import { useActionState } from "react";
import { takeRegisterAction } from "@/app/cohorts/actions";
import type { CohortActionState } from "@/app/cohorts/actions";
import type { RegisterLine } from "@/lib/scheduling";

/**
 * The register, taken in one submit.
 *
 * Every learner is submitted together rather than only the ones touched. A
 * register is a statement about the whole room at one moment, and sending only
 * the changes would make "not yet marked" indistinguishable from "marked and
 * then cleared" - a distinction that matters when the register is the evidence
 * that a session happened at all.
 */
export function RegisterForm({
  cohortId,
  sessionId,
  lines,
}: {
  cohortId: string;
  sessionId: string;
  lines: RegisterLine[];
}) {
  const [state, action, pending] = useActionState<CohortActionState, FormData>(
    takeRegisterAction,
    {},
  );

  if (lines.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nobody is on this cohort yet, so there is no register to take.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="sessionId" value={sessionId} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="pb-2">Learner</th>
              <th className="pb-2">Present</th>
              <th className="pb-2">Absent</th>
              <th className="pb-2">Excused</th>
              <th className="pb-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.userId} className="border-t border-[var(--border)]">
                <td className="py-2 pr-4">{line.name}</td>
                {(["present", "absent", "excused"] as const).map((status) => (
                  <td key={status} className="py-2 pr-4">
                    <input
                      type="radio"
                      name={`mark:${line.userId}`}
                      value={status}
                      defaultChecked={line.status === status}
                      aria-label={`${line.name} ${status}`}
                    />
                  </td>
                ))}
                <td className="py-2">
                  <input
                    name={`note:${line.userId}`}
                    defaultValue={line.note ?? ""}
                    placeholder="Reason, if excused"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.error ? (
        <p className="text-sm text-[var(--danger,#b00020)]">{state.error}</p>
      ) : null}
      {state.done ? (
        <p className="text-sm text-[var(--muted)]">{state.done}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save the register"}
      </button>

      <p className="text-xs text-[var(--muted)]">
        Excused means absent for a reason the provider accepted. It is kept
        apart from a plain absence because the learner support procedure turns
        on the difference.
      </p>
    </form>
  );
}
