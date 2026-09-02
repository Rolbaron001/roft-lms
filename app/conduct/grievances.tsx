"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  acknowledgeGrievanceAction,
  appointInvestigatorAction,
  decideGrievanceAction,
  type ConductActionState,
} from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

export type GrievanceRow = {
  id: string;
  learnerId: string;
  learnerName: string;
  nature: string;
  lodgedOn: string;
  acknowledgeBy: string;
  acknowledged: boolean;
  status: string;
  rawStatus: string;
  decisionDueBy: string | null;
};

/**
 * The open grievances, and the next step on each.
 *
 * Led by the acknowledgement deadline, because that is the promise the
 * procedure makes to the learner and the one nobody can otherwise see slipping.
 */
export function Grievances({
  rows,
  staff,
  today,
}: {
  rows: GrievanceRow[];
  staff: { id: string; name: string }[];
  today: string;
}) {
  const [ackState, ackAction] = useActionState<ConductActionState, FormData>(
    acknowledgeGrievanceAction,
    {},
  );
  const [appointState, appointAction] = useActionState<
    ConductActionState,
    FormData
  >(appointInvestigatorAction, {});
  const [decideState, decideAction, deciding] = useActionState<
    ConductActionState,
    FormData
  >(decideGrievanceAction, {});

  const [acting, setActing] = useState<string | null>(null);
  const error = ackState.error ?? appointState.error ?? decideState.error;

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted)]">Nothing open.</p>;
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      <ul className="space-y-4">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-md border border-[var(--border)] p-3"
          >
            <p className="text-sm font-medium">
              <Link
                href={`/people/${row.learnerId}`}
                className="hover:underline"
              >
                {row.learnerName}
              </Link>
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                lodged {row.lodgedOn} · {row.status}
              </span>
            </p>

            <p className="mt-1 text-sm">{row.nature}</p>

            {!row.acknowledged ? (
              <p
                className={
                  row.acknowledgeBy < today
                    ? "mt-1 text-xs text-[var(--danger)]"
                    : "mt-1 text-xs text-[var(--muted)]"
                }
              >
                Acknowledge by {row.acknowledgeBy}
              </p>
            ) : null}

            {row.decisionDueBy ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Decision due by {row.decisionDueBy}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {!row.acknowledged ? (
                <form action={ackAction}>
                  <input type="hidden" name="grievanceId" value={row.id} />
                  <button type="submit" className={buttonClass}>
                    Acknowledge
                  </button>
                </form>
              ) : null}

              {acting === `appoint:${row.id}` ? (
                <form action={appointAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="grievanceId" value={row.id} />
                  <select name="investigatorId" className={inputClass} required>
                    <option value="">Choose somebody</option>
                    {staff.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className={buttonClass}>
                    Appoint
                  </button>
                  <button
                    type="button"
                    onClick={() => setActing(null)}
                    className={buttonClass}
                  >
                    Cancel
                  </button>
                </form>
              ) : acting === `decide:${row.id}` ? (
                <form action={decideAction} className="w-full space-y-2">
                  <input type="hidden" name="grievanceId" value={row.id} />
                  <label className="block text-sm">
                    <span className="mr-2 text-[var(--muted)]">
                      Meeting held
                    </span>
                    <input
                      type="date"
                      name="meetingHeldOn"
                      defaultValue={today}
                      required
                      className={inputClass}
                    />
                  </label>
                  <textarea
                    name="decision"
                    rows={3}
                    defaultValue={decideState.values?.decision}
                    placeholder="What was found and what will be done. This goes to the learner in writing."
                    className={`${inputClass} block w-full`}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={deciding}
                      className={buttonClass}
                    >
                      {deciding ? "Saving…" : "Record the decision"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActing(null)}
                      className={buttonClass}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {row.rawStatus === "acknowledged" ? (
                    <button
                      type="button"
                      onClick={() => setActing(`appoint:${row.id}`)}
                      className={buttonClass}
                    >
                      Appoint an investigator
                    </button>
                  ) : null}
                  {row.rawStatus === "under_investigation" ? (
                    <button
                      type="button"
                      onClick={() => setActing(`decide:${row.id}`)}
                      className={buttonClass}
                    >
                      Record the decision
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-[var(--muted)]">
        The investigator must be somebody the grievance is not about. Naming one
        the learner has complained about is refused, because &ldquo;a designated
        impartial person&rdquo; is what the procedure promises and a short-staffed
        week is exactly when it gets broken.
      </p>
    </div>
  );
}
