"use client";

import { useActionState, useState } from "react";
import { authoriseAction, startOralAction, type ReviewState } from "./actions";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function Result({ state }: { state: ReviewState }) {
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
 * Recording what the programme review decided.
 *
 * The employer fields are not decoration. "We discussed it with the employer"
 * is the exact claim an external verifier tests, and an unnamed employer is
 * not evidence that a discussion happened — so naming one is required as soon
 * as the box is ticked, here and again in the library behind it.
 */
export function ReviewForm({
  assessmentId,
  userId,
}: {
  assessmentId: string;
  userId: string;
}) {
  const [state, act, pending] = useActionState<ReviewState, FormData>(
    authoriseAction,
    {},
  );
  const [consulted, setConsulted] = useState(false);

  return (
    <div>
      <form action={act} className="mt-3 space-y-3">
        <input type="hidden" name="assessmentId" value={assessmentId} />
        <input type="hidden" name="userId" value={userId} />

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">What was decided</span>
          <select name="outcome" defaultValue="oral_reassessment" className={field}>
            <option value="oral_reassessment">
              A third attempt, conducted orally
            </option>
            <option value="further_learning">
              Further learning before any further attempt
            </option>
            <option value="withdrawn">Withdrawn from the programme</option>
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Why</span>
          <textarea
            name="rationale"
            required
            minLength={10}
            rows={3}
            placeholder="What the review found, and what it turns on."
            className={field}
          />
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="employerConsulted"
            checked={consulted}
            onChange={(event) => setConsulted(event.target.checked)}
            className="mt-1"
          />
          <span>The employer was consulted</span>
        </label>

        {consulted ? (
          <>
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">
                Who, at the employer
              </span>
              <input
                name="employerRepresentative"
                required
                placeholder="Name and role"
                className={field}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">
                What they said{" "}
                <span className="font-normal text-[var(--muted)]">
                  (optional)
                </span>
              </span>
              <textarea name="employerComments" rows={2} className={field} />
            </label>
          </>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Recording…" : "Record the review"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}

/**
 * Opening the oral attempt the review authorised.
 *
 * Refused if the person pressing it is the one who authorised it — the same
 * separation the platform keeps between assessing and moderating.
 */
export function StartOral({ authorisationId }: { authorisationId: string }) {
  const [state, act, pending] = useActionState<ReviewState, FormData>(
    startOralAction,
    {},
  );

  return (
    <div>
      <form action={act}>
        <input
          type="hidden"
          name="authorisationId"
          value={authorisationId}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Opening…" : "Conduct the oral assessment"}
        </button>
      </form>
      <Result state={state} />
    </div>
  );
}
