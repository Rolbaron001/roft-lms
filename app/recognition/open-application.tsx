"use client";

import { useActionState } from "react";
import { openApplicationAction, type RecognitionState } from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

type Option = { id: string; label: string };

/**
 * Opening an RPL application.
 *
 * Deliberately small. The application is a container: it says who is applying
 * against which qualification and when, and everything of substance - the
 * advisory, the judgements, the moderation - attaches to it afterwards. Asking
 * for more here would be asking somebody to decide things they have not
 * assessed yet.
 */
export function OpenApplication({
  learners,
  qualifications,
}: {
  learners: Option[];
  qualifications: Option[];
}) {
  const [state, action, saving] = useActionState<RecognitionState, FormData>(
    openApplicationAction,
    {},
  );
  const kept = state.values ?? {};

  if (learners.length === 0 || qualifications.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        An application needs a learner and a qualification to apply against.
        Add those first.
      </p>
    );
  }

  return (
    <form key={state.attempt ?? 0} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Learner</span>
          <select
            name="learnerId"
            required
            defaultValue={kept.learnerId}
            className={`${inputClass} mt-1 block w-full`}
          >
            <option value="">Choose</option>
            {learners.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Against which qualification</span>
          <select
            name="qualificationId"
            required
            defaultValue={kept.qualificationId}
            className={`${inputClass} mt-1 block w-full`}
          >
            <option value="">Choose</option>
            {qualifications.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Applied on</span>
          <input
            type="date"
            name="appliedOn"
            required
            defaultValue={kept.appliedOn}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>
      </div>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {saving ? "Opening…" : "Open the application"}
      </button>
    </form>
  );
}
