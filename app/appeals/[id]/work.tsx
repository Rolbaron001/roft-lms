"use client";

import { useActionState } from "react";
import {
  acknowledgeAppealAction,
  addNoteAction,
  learnerInformedAction,
  recordProgressAction,
  resolveAppealAction,
  withdrawAppealAction,
  type AppealActionState,
} from "@/app/appeals/actions";
import { ZonedTime } from "@/components/zoned-time";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

export type WorkAppeal = {
  id: string;
  ground: "result" | "assessor_conduct";
  status: string;
  acknowledgedAt: Date | null;
  metLearnerOn: string | null;
  moderatorId: string | null;
  moderatorName: string | null;
  outcome: string | null;
  outcomeReason: string | null;
  resolvedAt: Date | null;
  learnerInformedAt: Date | null;
  withdrawnReason: string | null;
};

/**
 * The appeal, as the person handling it works it.
 *
 * One page holding the whole procedure in order, because the steps are done by
 * different people days apart and the thing that goes wrong is a step nobody
 * realised was outstanding.
 */
export function Work({
  appeal,
  zone,
  moderators,
  notes,
}: {
  appeal: WorkAppeal;
  zone: string;
  moderators: { id: string; name: string }[];
  notes: {
    id: string;
    note: string;
    visibleToLearner: boolean;
    createdAt: Date;
    authorName: string;
  }[];
}) {
  const [ackState, ackAction, acking] = useActionState<
    AppealActionState,
    FormData
  >(acknowledgeAppealAction, {});
  const [progressState, progressAction, progressing] = useActionState<
    AppealActionState,
    FormData
  >(recordProgressAction, {});
  const [resolveState, resolveAction, resolving] = useActionState<
    AppealActionState,
    FormData
  >(resolveAppealAction, {});
  const [informedState, informedAction, informing] = useActionState<
    AppealActionState,
    FormData
  >(learnerInformedAction, {});
  const [withdrawState, withdrawAction, withdrawing] = useActionState<
    AppealActionState,
    FormData
  >(withdrawAppealAction, {});
  const [noteState, noteAction, noting] = useActionState<
    AppealActionState,
    FormData
  >(addNoteAction, {});

  const closed = appeal.status === "resolved" || appeal.status === "withdrawn";
  const error =
    ackState.error ??
    progressState.error ??
    resolveState.error ??
    informedState.error ??
    withdrawState.error ??
    noteState.error;

  return (
    <div className="space-y-6">
      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {/* 1. Acknowledge */}
      <section className="border-b border-[var(--border)] pb-4">
        <h3 className="text-sm font-medium">Acknowledge receipt</h3>
        {appeal.acknowledgedAt ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Acknowledged{" "}
            <ZonedTime at={appeal.acknowledgedAt} zone={zone} withDate />.
          </p>
        ) : closed ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Closed without an acknowledgement being recorded.
          </p>
        ) : (
          <form action={ackAction} className="mt-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <p className="mb-2 text-xs text-[var(--muted)]">
              The first acknowledgement is the one the record keeps. It cannot
              be re-stamped later, because a time that can be changed is not
              evidence of anything.
            </p>
            <button type="submit" disabled={acking} className={buttonClass}>
              {acking ? "Recording…" : "Acknowledge"}
            </button>
          </form>
        )}
      </section>

      {/* 2. Work it */}
      {!closed ? (
        <section className="border-b border-[var(--border)] pb-4">
          <h3 className="text-sm font-medium">The meeting and the moderator</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {appeal.ground === "result"
              ? "A result appeal goes to the internal moderator before it can be resolved. That is the step an external verifier asks about."
              : "A conduct appeal is not something re-marking settles, so no moderator is required."}
          </p>

          <form action={progressAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <label className="text-sm">
              <span className="mr-2 text-[var(--muted)]">Met the learner</span>
              <input
                type="date"
                name="metLearnerOn"
                defaultValue={appeal.metLearnerOn ?? ""}
                className={inputClass}
              />
            </label>

            {appeal.ground === "result" ? (
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">Moderator</span>
                <select
                  name="moderatorId"
                  defaultValue={appeal.moderatorId ?? ""}
                  className={inputClass}
                >
                  <option value="">Not yet consulted</option>
                  {moderators.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <button type="submit" disabled={progressing} className={buttonClass}>
              {progressing ? "Saving…" : "Save"}
            </button>
          </form>
        </section>
      ) : null}

      {/* 3. Resolve */}
      <section className="border-b border-[var(--border)] pb-4">
        <h3 className="text-sm font-medium">Outcome</h3>
        {appeal.status === "resolved" ? (
          <div className="mt-1 space-y-2 text-sm">
            <p>
              <span className="font-medium capitalize">
                {appeal.outcome?.replace(/_/g, " ")}
              </span>{" "}
              <span className="text-[var(--muted)]">
                <ZonedTime at={appeal.resolvedAt} zone={zone} withDate />
              </span>
            </p>
            <p className="whitespace-pre-wrap">{appeal.outcomeReason}</p>

            {appeal.learnerInformedAt ? (
              <p className="text-[var(--muted)]">
                Learner told{" "}
                <ZonedTime at={appeal.learnerInformedAt} zone={zone} withDate />.
              </p>
            ) : (
              <form action={informedAction}>
                <input type="hidden" name="appealId" value={appeal.id} />
                <p className="mb-2 text-xs text-[var(--muted)]">
                  A decision the learner has not been given is not feedback.
                </p>
                <button
                  type="submit"
                  disabled={informing}
                  className={buttonClass}
                >
                  {informing ? "Recording…" : "The learner has been told"}
                </button>
              </form>
            )}
          </div>
        ) : appeal.status === "withdrawn" ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Withdrawn: {appeal.withdrawnReason}
          </p>
        ) : (
          <form action={resolveAction} className="mt-2 space-y-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <select name="outcome" className={inputClass} defaultValue="">
              <option value="" disabled>
                Choose an outcome
              </option>
              <option value="upheld">Upheld</option>
              <option value="partially_upheld">Partially upheld</option>
              <option value="dismissed">Dismissed</option>
            </select>
            <textarea
              name="outcomeReason"
              rows={3}
              placeholder="Why. This is the part the learner is entitled to."
              className={`${inputClass} block w-full`}
            />
            <button type="submit" disabled={resolving} className={buttonClass}>
              {resolving ? "Resolving…" : "Resolve"}
            </button>
          </form>
        )}
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-sm font-medium">Notes</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          The discussion between coordinator, assessor and moderator. Not shown
          to the learner unless you say so — what they are entitled to is the
          outcome and the reasoning above.
        </p>

        {notes.length > 0 ? (
          <ul className="mt-3 space-y-3 text-sm">
            {notes.map((note) => (
              <li key={note.id}>
                <span className="text-xs text-[var(--muted)]">
                  {note.authorName} ·{" "}
                  <ZonedTime
                    at={note.createdAt}
                    zone={zone}
                    withDate
                    showViewer={false}
                  />
                  {note.visibleToLearner ? " · visible to the learner" : ""}
                </span>
                <p className="whitespace-pre-wrap">{note.note}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <form action={noteAction} className="mt-3 space-y-2">
          <input type="hidden" name="appealId" value={appeal.id} />
          <textarea
            name="note"
            rows={2}
            placeholder="What was discussed, and with whom"
            className={`${inputClass} block w-full`}
          />
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <input type="checkbox" name="visibleToLearner" />
            The learner may read this
          </label>
          <button type="submit" disabled={noting} className={buttonClass}>
            {noting ? "Saving…" : "Add a note"}
          </button>
        </form>
      </section>

      {!closed ? (
        <section className="border-t border-[var(--border)] pt-4">
          <form action={withdrawAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <input
              name="reason"
              placeholder="Why it is being withdrawn"
              className={`${inputClass} flex-1 min-w-48`}
            />
            <button type="submit" disabled={withdrawing} className={buttonClass}>
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </button>
          </form>
          <p className="mt-2 text-xs text-[var(--muted)]">
            A withdrawal needs a reason. One with none looks like pressure, and
            that is exactly what an appeal about conduct would be about.
          </p>
        </section>
      ) : null}
    </div>
  );
}
