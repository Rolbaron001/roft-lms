"use client";

import { useActionState } from "react";
import { createPathAction, type PathState } from "./actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export function NewPathForm() {
  const [state, action, pending] = useActionState<PathState, FormData>(
    createPathAction,
    {},
  );

  return (
    <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        New programme
      </h2>

      {state.error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <form action={action} className="mt-4 space-y-3">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Title</span>
          <input
            name="title"
            required
            minLength={3}
            placeholder="New Starter Programme"
            className={inputClass}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Description</span>
          <textarea name="description" rows={2} className={inputClass} />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Creating…" : "Create programme"}
        </button>
      </form>
    </section>
  );
}
