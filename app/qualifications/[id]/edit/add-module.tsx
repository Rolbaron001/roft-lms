"use client";

import { useActionState } from "react";
import { addModuleAction, type EditorState } from "./actions";

const COMPONENTS = [
  ["knowledge", "Knowledge module"],
  ["practical", "Practical skills module"],
  ["workplace", "Work experience module"],
  ["general", "Module"],
] as const;

/**
 * Adding a module.
 *
 * The component choice is what everything else follows from — it decides which
 * kinds of line the topics can hold, and whether the module is evidenced by
 * assessment criteria or by a signed logbook. So it is asked first, in words
 * rather than in codes, and the note underneath says what the choice means.
 */
export function AddModule({ qualificationId }: { qualificationId: string }) {
  const [state, act, pending] = useActionState<EditorState, FormData>(
    addModuleAction,
    {},
  );

  return (
    <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">Add a module</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        A work experience module is evidenced by a logbook a coach signs, not by
        assessment criteria, so it takes work activities instead.
      </p>

      <form action={act} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="qualificationId" value={qualificationId} />

        <label className="text-xs text-[var(--muted)]">
          Kind
          <select
            name="component"
            defaultValue="knowledge"
            className="mt-1 block rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          >
            {COMPONENTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-[var(--muted)]">
          Code
          <input
            name="code"
            required
            placeholder="121150-KM-01"
            className="mt-1 block w-44 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-sm"
          />
        </label>

        <label className="flex-1 text-xs text-[var(--muted)]">
          Title
          <input
            name="title"
            required
            placeholder="As the curriculum document titles it"
            className="mt-1 block w-full min-w-48 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          />
        </label>

        <label className="text-xs text-[var(--muted)]">
          Credits
          <input
            name="credits"
            type="number"
            min={0}
            className="mt-1 block w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add module"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
