"use client";

import { useActionState } from "react";
import { bulkEnrolAction, enrolOneAction, type EnrolState } from "./actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function Message({ state }: { state: EnrolState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function EnrolmentPanel({
  courseId,
  people,
}: {
  courseId: string;
  people: { id: string; label: string }[];
}) {
  const [oneState, oneAction, onePending] = useActionState<EnrolState, FormData>(
    enrolOneAction,
    {},
  );
  const [bulkState, bulkAction, bulkPending] = useActionState<
    EnrolState,
    FormData
  >(bulkEnrolAction, {});

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Enrol one person
        </h2>

        <form action={oneAction} className="mt-4 space-y-3">
          <input type="hidden" name="courseId" value={courseId} />

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Person</span>
            <select name="userId" defaultValue="" className={inputClass}>
              <option value="">Choose someone…</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Due date{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input type="date" name="dueDate" className={inputClass} />
          </label>

          <Message state={oneState} />

          <button
            type="submit"
            disabled={onePending || people.length === 0}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand-primary)" }}
          >
            {onePending ? "Enrolling…" : "Enrol"}
          </button>

          {people.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Everyone in the organisation is already on this course.
            </p>
          ) : null}
        </form>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Enrol many at once
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Paste email addresses, one per line. A column copied straight out of a
          spreadsheet works.
        </p>

        <form action={bulkAction} className="mt-4 space-y-3">
          <input type="hidden" name="courseId" value={courseId} />

          <textarea
            name="emails"
            rows={6}
            placeholder={"someone@example.com\nsomeone.else@example.com"}
            className={`${inputClass} font-mono text-xs`}
          />

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Due date{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input type="date" name="dueDate" className={inputClass} />
          </label>

          <Message state={bulkState} />

          <button
            type="submit"
            disabled={bulkPending}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {bulkPending ? "Enrolling…" : "Enrol everyone listed"}
          </button>
        </form>
      </section>
    </div>
  );
}
