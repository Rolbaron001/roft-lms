"use client";

import { useActionState } from "react";
import { importStatementsAction, type ImportState } from "./actions";

/** Bringing in learning recorded by another system. */
export function ImportForm() {
  const [state, act, pending] = useActionState<ImportState, FormData>(importStatementsAction, {});

  return (
    <form action={act} className="space-y-3">
      <input
        name="file"
        type="file"
        required
        accept=".json,application/json"
        className="block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import the statements"}
      </button>

      {state.error ? (
        <p role="alert" className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      {state.summary ? (
        <div className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm">
          <p style={{ color: "var(--success)" }}>
            {state.summary.added} of {state.summary.read} statements added
            {state.summary.alreadyHeld > 0 ? `; ${state.summary.alreadyHeld} were already held` : ""}.
          </p>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            <li>
              {state.summary.learnersMatched} {state.summary.learnersMatched === 1 ? "learner" : "learners"} matched by
              email. Their imported learning shows on their record under People.
            </li>
            {state.summary.unmatchedActors.length > 0 ? (
              <li>
                Not matched to anybody here, and kept until they are:{" "}
                {state.summary.unmatchedActors.slice(0, 10).join(", ")}
                {state.summary.unmatchedActors.length > 10 ? "…" : ""}. Invite them with the same email and their
                learning attaches.
              </li>
            ) : null}
            {state.summary.rejected.length > 0 ? (
              <li>
                Not read: {state.summary.rejected.slice(0, 5).join(" ")}
                {state.summary.rejected.length > 5 ? ` …and ${state.summary.rejected.length - 5} more.` : ""}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
