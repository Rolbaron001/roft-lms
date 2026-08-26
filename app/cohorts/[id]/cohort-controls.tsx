"use client";

import { useActionState, useState } from "react";
import {
  addMemberAction,
  removeMemberAction,
  rescheduleCohortAction,
  setScheduleAction,
  type CohortActionState,
} from "../actions";

const field =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";
const primary =
  "rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60";

function Result({ state }: { state: CohortActionState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="mt-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.done) {
    return (
      <p className="mt-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.done}
      </p>
    );
  }
  return null;
}

/**
 * Moving the start date.
 *
 * One field, because that is genuinely all it takes: the schedule is held as
 * offsets, so moving the start moves every date derived from it in one write.
 */
export function Reschedule({
  cohortId,
  startDate,
}: {
  cohortId: string;
  startDate: string;
}) {
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    rescheduleCohortAction,
    {},
  );

  return (
    <div>
      <form action={act} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="cohortId" value={cohortId} />
        <label className="space-y-1.5">
          <span className="block text-sm font-medium">Start date</span>
          <input
            name="startDate"
            type="date"
            defaultValue={startDate}
            required
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className={primary}
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Moving…" : "Move the start"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

export type EditableStep = {
  id: string;
  title: string | null;
  kind: string;
  opensAfterDays: number | null;
  dueAfterDays: number | null;
  closesAfterDays: number | null;
};

/**
 * The rollout, as days from the start.
 *
 * One form and one save for the whole thing, because the library replaces a
 * cohort's schedule rather than merging into it — a per-row save would delete
 * every other row. Every step is posted, including the blank ones.
 *
 * Days rather than dates on purpose: a rollout is designed once as "week two,
 * week three" and then run for intake after intake. Typing dates would mean
 * redesigning it every time.
 */
export function ScheduleEditor({
  cohortId,
  startDate,
  steps,
}: {
  cohortId: string;
  startDate: string;
  steps: EditableStep[];
}) {
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    setScheduleAction,
    {},
  );

  // Days are what gets stored; dates are what a facilitator is thinking in.
  // Showing the date beside the number as it is typed is what stops "day 45"
  // being agreed in a meeting and turning out to be the festive season.
  const [days, setDays] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const step of steps) {
      initial[`opens-${step.id}`] = step.opensAfterDays?.toString() ?? "";
      initial[`due-${step.id}`] = step.dueAfterDays?.toString() ?? "";
      initial[`closes-${step.id}`] = step.closesAfterDays?.toString() ?? "";
    }
    return initial;
  });

  function on(name: string) {
    return {
      value: days[name] ?? "",
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setDays((current) => ({ ...current, [name]: event.target.value })),
    };
  }

  function dateFor(stepId: string, which: "opens" | "due" | "closes") {
    // Closing is a grace period counted from the due date, not from the start.
    const offset =
      which === "closes"
        ? add(days[`due-${stepId}`], days[`closes-${stepId}`])
        : Number(days[`${which}-${stepId}`]);

    if (offset === null || !Number.isFinite(offset)) return null;
    if (days[`${which}-${stepId}`] === "") return null;

    return describeDay(startDate, offset);
  }

  if (steps.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        This cohort&rsquo;s course has no steps yet, so there is nothing to
        schedule.
      </p>
    );
  }

  return (
    <form action={act}>
      <input type="hidden" name="cohortId" value={cohortId} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="pb-2">Step</th>
              <th className="pb-2">Opens on day</th>
              <th className="pb-2">Due on day</th>
              <th className="pb-2">Closes days after due</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.id} className="border-t border-[var(--border)]">
                <td className="py-2 pr-3">
                  {step.title ?? step.kind}
                  <input type="hidden" name="stepId" value={step.id} />
                </td>
                <td className="py-2 pr-3">
                  <input
                    name={`opens-${step.id}`}
                    type="number"
                    min={0}
                    {...on(`opens-${step.id}`)}
                    placeholder="—"
                    aria-label={`${step.title ?? step.kind}: opens on day`}
                    className={`${field} w-24`}
                  />
                  <span className="ml-2 text-xs text-[var(--muted)] tabular-nums">
                    {dateFor(step.id, "opens")}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <input
                    name={`due-${step.id}`}
                    type="number"
                    min={0}
                    {...on(`due-${step.id}`)}
                    placeholder="—"
                    aria-label={`${step.title ?? step.kind}: due on day`}
                    className={`${field} w-24`}
                  />
                  <span className="ml-2 text-xs text-[var(--muted)] tabular-nums">
                    {dateFor(step.id, "due")}
                  </span>
                </td>
                <td className="py-2">
                  <input
                    name={`closes-${step.id}`}
                    type="number"
                    min={0}
                    {...on(`closes-${step.id}`)}
                    placeholder="—"
                    aria-label={`${step.title ?? step.kind}: closes days after due`}
                    className={`${field} w-24`}
                  />
                  <span className="ml-2 text-xs text-[var(--muted)] tabular-nums">
                    {dateFor(step.id, "closes")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        Day 0 is the start date. Leave a row empty and that step carries no
        dates at all — it opens as soon as whatever comes before it is done.
      </p>

      <button
        type="submit"
        disabled={pending}
        className={`mt-3 ${primary}`}
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? "Saving…" : "Save the schedule"}
      </button>

      <Result state={state} />
    </form>
  );
}

/** Two day counts that only mean something together. */
function add(first: string | undefined, second: string | undefined): number | null {
  if (!first || !second) return null;
  const total = Number(first) + Number(second);
  return Number.isFinite(total) ? total : null;
}

/** The calendar day a number of days from the start lands on. */
function describeDay(startDate: string, days: number): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type Candidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

/** Adding somebody to the register, which also enrols them on the course. */
export function AddMember({
  cohortId,
  candidates,
}: {
  cohortId: string;
  candidates: Candidate[];
}) {
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    addMemberAction,
    {},
  );

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Everybody with a learner account is already on this cohort. Invite more
        people from the People screen first.
      </p>
    );
  }

  return (
    <div>
      <form action={act} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="cohortId" value={cohortId} />
        <label className="flex-1 space-y-1.5">
          <span className="block text-sm font-medium">Add a learner</span>
          <select name="userId" required className={`${field} w-full`}>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.lastName}, {person.firstName} — {person.email}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className={primary}
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

/**
 * Taking somebody off the register.
 *
 * Confirmed, because it is not a display change: it marks them as having left
 * and their access to the cohort's material goes with it.
 */
export function RemoveMember({
  cohortId,
  userId,
  name,
}: {
  cohortId: string;
  userId: string;
  name: string;
}) {
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    removeMemberAction,
    {},
  );

  return (
    <span>
      <form
        action={act}
        className="inline"
        onSubmit={(event) => {
          if (!window.confirm(`Take ${name} off this cohort?`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="cohortId" value={cohortId} />
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-[var(--danger)] hover:underline disabled:opacity-60"
        >
          {pending ? "…" : "Remove"}
        </button>
      </form>
      {state.error ? (
        <span role="alert" className="ml-2 text-xs text-[var(--danger)]">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
