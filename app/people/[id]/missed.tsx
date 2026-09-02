"use client";

import { useActionState, useState } from "react";
import {
  recordAdditionalDateOutcomeAction,
  recordMissedAssessmentAction,
  type SupportActionState,
} from "@/app/people/support-actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

const OUTCOME_LABEL: Record<string, string> = {
  additional_date_set: "Additional date set",
  sat: "Sat on the additional date",
  oral_authorised: "Oral assessment authorised",
  forfeited: "Forfeited",
};

export type MissedRow = {
  id: string;
  assessmentTitle: string;
  missedOn: string;
  missedReason: string | null;
  additionalDate: string | null;
  outcome: string;
  secondMissMedical: boolean;
  secondMissNote: string | null;
};

/**
 * A missed summative and the one additional date it earns.
 *
 * The count is the whole reason this is on screen. A learner who has already
 * had their additional date shows it here, so the next person asked for
 * another can see they are the second person being asked.
 */
export function Missed({
  learnerId,
  records,
  assessments,
  canManage,
  today,
}: {
  learnerId: string;
  records: MissedRow[];
  assessments: { id: string; title: string }[];
  canManage: boolean;
  today: string;
}) {
  const [state, action, saving] = useActionState<SupportActionState, FormData>(
    recordMissedAssessmentAction,
    {},
  );
  const [outcomeState, outcomeAction, recording] = useActionState<
    SupportActionState,
    FormData
  >(recordAdditionalDateOutcomeAction, {});
  const [open, setOpen] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [chosen, setChosen] = useState("sat");

  const error = state.error ?? outcomeState.error;

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      {records.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No missed summative dates.
        </p>
      ) : (
        <ul className="space-y-3">
          {records.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-[var(--border)] p-3 text-sm"
            >
              <p className="font-medium">{row.assessmentTitle}</p>
              <p className="mt-1 text-[var(--muted)]">
                Missed {row.missedOn}
                {row.missedReason ? `: ${row.missedReason}` : ""}
                {row.additionalDate
                  ? ` · additional date ${row.additionalDate}`
                  : ""}
              </p>
              <p className="mt-1">
                {OUTCOME_LABEL[row.outcome] ?? row.outcome}
                {row.secondMissMedical ? " (medical)" : ""}
                {row.secondMissNote ? `: ${row.secondMissNote}` : ""}
              </p>

              {canManage && row.outcome === "additional_date_set" ? (
                outcomeFor === row.id ? (
                  <form action={outcomeAction} className="mt-3 space-y-2">
                    <input type="hidden" name="learnerId" value={learnerId} />
                    <input
                      type="hidden"
                      name="missedAssessmentId"
                      value={row.id}
                    />
                    <select
                      name="outcome"
                      value={chosen}
                      onChange={(event) => setChosen(event.target.value)}
                      className={inputClass}
                    >
                      <option value="sat">They sat it</option>
                      <option value="forfeited">Missed it again</option>
                      <option value="oral_authorised">
                        Missed it again — authorise an oral assessment
                      </option>
                    </select>

                    {chosen === "oral_authorised" ? (
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="medical" />
                          The second miss was on medical grounds
                        </label>
                        <textarea
                          name="note"
                          rows={2}
                          placeholder="What the medical ground was"
                          className={`${inputClass} block w-full`}
                        />
                        <p className="text-xs text-[var(--muted)]">
                          The oral route opens on a medical ground and nothing
                          else. Without one the outcome is a forfeit, which the
                          learner can still appeal.
                        </p>
                      </div>
                    ) : null}

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={recording}
                        className={buttonClass}
                      >
                        {recording ? "Saving…" : "Record"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOutcomeFor(null)}
                        className={buttonClass}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOutcomeFor(row.id)}
                    className={`${buttonClass} mt-2`}
                  >
                    Record what happened
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && assessments.length > 0 ? (
        !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={buttonClass}
          >
            Record a missed date
          </button>
        ) : (
          <form action={action} className="space-y-2">
            <input type="hidden" name="learnerId" value={learnerId} />
            <div className="flex flex-wrap gap-2">
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">Assessment</span>
                <select name="assessmentId" className={inputClass} required>
                  {assessments.map((assessment) => (
                    <option key={assessment.id} value={assessment.id}>
                      {assessment.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">Missed</span>
                <input
                  type="date"
                  name="missedOn"
                  defaultValue={today}
                  required
                  className={inputClass}
                />
              </label>
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">
                  Additional date
                </span>
                <input
                  type="date"
                  name="additionalDate"
                  required
                  className={inputClass}
                />
              </label>
            </div>
            <input
              name="missedReason"
              placeholder="Why it was missed, if known"
              className={`${inputClass} block w-full`}
            />
            <p className="text-xs text-[var(--muted)]">
              One additional date, and one only. Recording it here is what stops
              a third being arranged later by somebody who did not know about
              this one.
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Set the additional date"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={buttonClass}
              >
                Cancel
              </button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}
