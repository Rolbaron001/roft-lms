"use client";

import { useActionState } from "react";
import { recordDecisionAction, type DecisionState } from "../actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export function DecisionForm({
  submissionId,
  criteria,
}: {
  submissionId: string;
  criteria: { id: string; code: string; description: string }[];
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(
    recordDecisionAction,
    {},
  );

  return (
    <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Your judgement
      </h2>

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="submissionId" value={submissionId} />

        {criteria.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Against each criterion
            </legend>
            {criteria.map((criterion) => (
              <div key={criterion.id} className="space-y-1">
                <p className="text-sm">
                  <span className="font-medium">{criterion.code}</span>{" "}
                  <span className="text-[var(--muted)]">
                    {criterion.description}
                  </span>
                </p>
                <select
                  name={`criterion:${criterion.id}`}
                  defaultValue="competent"
                  className={inputClass}
                  aria-label={`Outcome for ${criterion.code}`}
                >
                  <option value="competent">Competent</option>
                  <option value="not_yet_competent">Not yet competent</option>
                </select>
              </div>
            ))}
          </fieldset>
        ) : null}

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Overall outcome</span>
          <select name="outcome" defaultValue="competent" className={inputClass}>
            <option value="competent">Competent</option>
            <option value="not_yet_competent">Not yet competent</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            Comments{" "}
            <span className="font-normal text-[var(--muted)]">
              (kept with the record)
            </span>
          </span>
          <textarea name="comments" rows={4} className={inputClass} />
        </label>

        {state.error ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Recording…" : "Sign and record decision"}
        </button>

        <p className="text-xs text-[var(--muted)]">
          Your name, the date and this comment are stored permanently and cannot
          be edited afterwards. A correction is recorded as a new decision.
        </p>
      </form>
    </aside>
  );
}
