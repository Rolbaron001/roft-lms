"use client";

import { useActionState, useState } from "react";
import {
  addMemberAction,
  removeMemberAction,
  rescheduleCohortAction,
  setScheduleAction,
  setStepReleasedAction,
  rolloutAction,
  type CohortActionState,
  type RolloutState,
} from "../actions";
import { useT } from "@/components/i18n";

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
  const t = useT();
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    rescheduleCohortAction,
    {},
  );

  return (
    <div>
      <form action={act} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="cohortId" value={cohortId} />
        <label className="space-y-1.5">
          <span className="block text-sm font-medium">{t("cohortCtl.start")}</span>
          <input name="startDate" type="date" defaultValue={startDate} required className={field} />
        </label>
        <button type="submit" disabled={pending} className={primary} style={{ background: "var(--brand-primary)" }}>
          {pending ? t("cohortCtl.moving") : t("cohortCtl.move")}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

/**
 * Reading the cohort's roll-out schedule (lib/rollout-import.ts): check
 * first, then save. The file stays chosen between the two presses.
 */
export function RolloutImport({ cohortId }: { cohortId: string }) {
  const t = useT();
  const [state, act, pending] = useActionState<RolloutState, FormData>(rolloutAction, {});
  const preview = state.preview;
  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input name="file" type="file" accept=".xlsx" required className="block text-sm" />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="mode" value="check" disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-60">
          {t("rolloutImport.check")}
        </button>
        {preview ? (
          <button type="submit" name="mode" value="apply" disabled={pending} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
            {t("rolloutImport.apply", { steps: preview.entries.length, sessions: preview.sessions })}
          </button>
        ) : null}
      </div>
      {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.done ? <p className="text-sm text-[var(--success)]">{state.done}</p> : null}
      {preview ? (
        <div className="space-y-2 text-sm">
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
                {preview.entries.map((entry, index) => (
                  <tr key={index} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-3">{entry.title}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{entry.opens ?? "—"}</td>
                    <td className="py-1.5 tabular-nums">{entry.due ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.unmatched.length > 0 ? <p className="text-[var(--danger)]">{t("rolloutImport.unmatched", { names: preview.unmatched.join(", ") })}</p> : null}
          {preview.undated.length > 0 ? <p className="text-[var(--muted)]">{t("rolloutImport.undated", { names: preview.undated.join(", ") })}</p> : null}
          {preview.unused > 0 ? <p className="text-[var(--muted)]">{t("rolloutImport.unused", { count: preview.unused })}</p> : null}
        </div>
      ) : null}
    </form>
  );
}

/**
 * What the cohort can reach today, and the facilitator's hand on it.
 *
 * Heidi, 5 October 2026: a workbook does not reach the learners "until that
 * particular date or until the facilitator clicks a button and says okay,
 * release this". One button a row; a hand release can be taken back, which
 * returns the step to its date.
 */
export function ReleaseControls({
  cohortId,
  steps,
}: {
  cohortId: string;
  steps: { id: string; title: string | null; kind: string; released: boolean; releasedAt: Date | null; opensAt: Date | null }[];
}) {
  const t = useT();
  const [state, act, pending] = useActionState<CohortActionState, FormData>(setStepReleasedAction, {});
  if (steps.length === 0) return null;
  return (
    <div>
      <ul className="divide-y divide-[var(--border)]">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm">{step.title ?? step.kind}</p>
              <p className="text-xs text-[var(--muted)]">
                {step.releasedAt
                  ? t("cohortCtl.releasedByHand", { date: step.releasedAt.toISOString().slice(0, 10) })
                  : step.released
                    ? t("cohortCtl.releasedBySchedule")
                    : step.opensAt
                      ? t("cohortCtl.opensOn", { date: step.opensAt.toISOString().slice(0, 10) })
                      : t("cohortCtl.notReleased")}
              </p>
            </div>
            <form action={act}>
              <input type="hidden" name="cohortId" value={cohortId} />
              <input type="hidden" name="stepId" value={step.id} />
              <input type="hidden" name="released" value={step.releasedAt ? "no" : "yes"} />
              {step.releasedAt ? (
                <button type="submit" disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium disabled:opacity-60">
                  {t("cohortCtl.takeBack")}
                </button>
              ) : step.released ? null : (
                <button type="submit" disabled={pending} className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
                  {t("cohortCtl.releaseNow")}
                </button>
              )}
            </form>
          </li>
        ))}
      </ul>
      {state.error ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.done ? <p className="mt-2 text-sm text-[var(--success)]">{state.done}</p> : null}
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
 * cohort's schedule rather than merging into it: a per-row save would delete
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
  const t = useT();
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
    return <p className="text-sm text-[var(--muted)]">{t("cohortCtl.noSteps")}</p>;
  }

  return (
    <form action={act}>
      <input type="hidden" name="cohortId" value={cohortId} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="pb-2">{t("cohortCtl.step")}</th>
              <th className="pb-2">{t("cohortCtl.opensDay")}</th>
              <th className="pb-2">{t("cohortCtl.dueDay")}</th>
              <th className="pb-2">{t("cohortCtl.closesAfter")}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => {
              const name = step.title ?? step.kind;
              return (
                <tr key={step.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3">
                    {name}
                    <input type="hidden" name="stepId" value={step.id} />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      name={`opens-${step.id}`}
                      type="number"
                      min={0}
                      {...on(`opens-${step.id}`)}
                      placeholder="—"
                      aria-label={t("cohortCtl.opensLabel", { step: name })}
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
                      aria-label={t("cohortCtl.dueLabel", { step: name })}
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
                      aria-label={t("cohortCtl.closesLabel", { step: name })}
                      className={`${field} w-24`}
                    />
                    <span className="ml-2 text-xs text-[var(--muted)] tabular-nums">
                      {dateFor(step.id, "closes")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">{t("cohortCtl.dayZero")}</p>

      <button
        type="submit"
        disabled={pending}
        className={`mt-3 ${primary}`}
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? t("common.saving") : t("cohortCtl.save")}
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
  const t = useT();
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    addMemberAction,
    {},
  );

  if (candidates.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("cohortCtl.everybody")}</p>;
  }

  return (
    <div>
      <form action={act} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="cohortId" value={cohortId} />
        <label className="flex-1 space-y-1.5">
          <span className="block text-sm font-medium">{t("cohortCtl.addLearner")}</span>
          <select name="userId" required className={`${field} w-full`}>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.lastName}, {person.firstName} · {person.email}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={primary} style={{ background: "var(--brand-primary)" }}>
          {pending ? t("cohortCtl.adding") : t("cohortCtl.add")}
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
  const t = useT();
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
          if (!window.confirm(t("cohortCtl.confirmRemove", { name }))) {
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
          {pending ? "…" : t("cohortCtl.remove")}
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
