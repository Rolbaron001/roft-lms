"use client";

import { useActionState } from "react";
import { createCourseAction, type ActionState } from "../actions";

export function NewCourseForm({
  curriculumModules,
}: {
  curriculumModules: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createCourseAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Course title</span>
        <input
          name="title"
          required
          minLength={3}
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Description</span>
        <textarea
          name="description"
          rows={3}
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          Curriculum module{" "}
          <span className="font-normal text-[var(--muted)]">(optional)</span>
        </span>
        <select
          name="curriculumModuleId"
          defaultValue=""
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
        >
          <option value="">Not part of an accredited qualification</option>
          {curriculumModules.map((module) => (
            <option key={module.id} value={module.id}>
              {module.label}
            </option>
          ))}
        </select>
        <span className="block text-xs text-[var(--muted)]">
          Bind the course to a curriculum module and the system will check, before
          it can be published, that every assessment criterion in that module has
          a lesson behind it.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? "Creating…" : "Create course"}
      </button>
    </form>
  );
}
