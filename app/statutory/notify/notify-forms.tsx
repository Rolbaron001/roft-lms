"use client";

import { useActionState, useState } from "react";
import {
  acknowledgeAction,
  draftAction,
  ownInductionAction,
  submitAction,
  type NotifyState,
} from "./actions";

const input =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function Message({ state }: { state: NotifyState }) {
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
  if (state.notice) {
    return (
      <p className="mt-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

export type DueRow = {
  userId: string;
  firstName: string;
  lastName: string;
  cohortId: string | null;
  cohortName: string | null;
  programme: string | null;
  inductionOn: string | null;
  dueOn: string | null;
  workingDaysLeft: number | null;
  state: string;
};

/**
 * Choosing who a submission covers.
 *
 * Everybody outstanding is offered, pre-ticked, because the ordinary case is a
 * whole cohort going at once. A late joiner is left unticked and marked: they
 * need their own submission, and quietly folding them into the cohort's is
 * exactly the mistake this screen exists to stop.
 */
export function DraftForm({ rows }: { rows: DueRow[] }) {
  const [state, act, working] = useActionState<NotifyState, FormData>(
    draftAction,
    {},
  );

  const outstanding = rows.filter(
    (r) => r.state !== "notified" && r.state !== "no_induction",
  );

  // The date most of them share, which is the cohort's induction.
  const commonest =
    outstanding
      .map((r) => r.inductionOn)
      .filter(Boolean)
      .sort(
        (a, b) =>
          outstanding.filter((r) => r.inductionOn === b).length -
          outstanding.filter((r) => r.inductionOn === a).length,
      )[0] ?? "";

  const [inductionOn, setInductionOn] = useState(commonest);

  // Only those inducted on the chosen day belong on this submission. The
  // deadline is computed from that date, so mixing days would be wrong.
  const eligible = outstanding.filter((r) => r.inductionOn === inductionOn);

  if (outstanding.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nobody is outstanding. Every learner with an induction date has been
        notified about.
      </p>
    );
  }

  return (
    <form action={act} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">What to call it</span>
          <input
            name="title"
            defaultValue="Enrolment notification"
            className={`${input} w-full`}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Induction date</span>
          <input
            name="inductionOn"
            type="date"
            value={inductionOn}
            onChange={(e) => setInductionOn(e.target.value)}
            className={`${input} w-full`}
          />
          <span className="block text-xs text-[var(--muted)]">
            The clock runs from this day.
          </span>
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">What they are on</span>
          <select name="kind" defaultValue="full" className={`${input} w-full`}>
            <option value="full">Full qualification — 21 working days</option>
            <option value="part">Part qualification — 21 working days</option>
            <option value="skills_programme">
              Skills programme — 5 working days
            </option>
          </select>
        </label>
      </div>

      <input
        type="hidden"
        name="cohortId"
        value={eligible[0]?.cohortId ?? ""}
      />

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">
          Who this covers
          <span className="ml-2 font-normal text-[var(--muted)]">
            {eligible.length} inducted on that day
          </span>
        </legend>

        {eligible.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Nobody outstanding was inducted on that date. Change the date, or
            give a late joiner their own induction below.
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] p-3">
            {eligible.map((row) => (
              <label
                key={row.userId}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="learnerIds"
                  value={row.userId}
                  defaultChecked
                />
                <span>
                  {row.firstName} {row.lastName}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {row.cohortName} · due {row.dueOn}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={working || eligible.length === 0}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {working ? "Drafting…" : "Draft the submission"}
      </button>

      <Message state={state} />
    </form>
  );
}

/** Records that the workbook went to the QCTO. */
export function SubmitForm({ notificationId }: { notificationId: string }) {
  const [state, act, working] = useActionState<NotifyState, FormData>(
    submitAction,
    {},
  );

  return (
    <form action={act} className="inline">
      <input type="hidden" name="notificationId" value={notificationId} />
      <button
        type="submit"
        disabled={working}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {working ? "Recording…" : "Record as sent"}
      </button>
      <Message state={state} />
    </form>
  );
}

/** Records what the QCTO sent back. */
export function AcknowledgeForm({
  notificationId,
}: {
  notificationId: string;
}) {
  const [state, act, working] = useActionState<NotifyState, FormData>(
    acknowledgeAction,
    {},
  );

  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="notificationId" value={notificationId} />
      <label className="space-y-1">
        <span className="block text-xs text-[var(--muted)]">
          Their reference
        </span>
        <input name="reference" className={input} placeholder="QCTO-ACK-…" />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-[var(--muted)]">On</span>
        <input name="acknowledgedOn" type="date" className={input} />
      </label>
      <button
        type="submit"
        disabled={working}
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
      >
        {working ? "Saving…" : "Record acknowledgement"}
      </button>
      <Message state={state} />
    </form>
  );
}

/**
 * Giving a late joiner their own induction date.
 *
 * Heidi, 9 September: somebody joining after the cohort starts needs their own
 * induction, their own enrolment form and their own LEISA. This is where the
 * first of those is recorded, and the other two follow from it.
 */
export function OwnInductionForm({ rows }: { rows: DueRow[] }) {
  const [state, act, working] = useActionState<NotifyState, FormData>(
    ownInductionAction,
    {},
  );

  const candidates = rows.filter((r) => r.state !== "notified" && r.cohortId);

  if (candidates.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nobody is waiting on an induction date.
      </p>
    );
  }

  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <label className="space-y-1">
        <span className="block text-xs text-[var(--muted)]">Who</span>
        <select name="userId" className={input}>
          {candidates.map((row) => (
            <option key={row.userId} value={row.userId}>
              {row.firstName} {row.lastName} — {row.cohortName}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="cohortId" value={candidates[0].cohortId ?? ""} />
      <label className="space-y-1">
        <span className="block text-xs text-[var(--muted)]">
          Their own induction
        </span>
        <input name="inductionOn" type="date" className={input} />
      </label>
      <button
        type="submit"
        disabled={working}
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
      >
        {working ? "Saving…" : "Set it"}
      </button>
      <Message state={state} />
    </form>
  );
}
