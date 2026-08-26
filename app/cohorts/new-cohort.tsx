"use client";

import { useActionState, useState } from "react";
import { createCohortAction, type CohortActionState } from "./actions";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export type CourseOption = {
  id: string;
  title: string;
  status: string;
  version: number | null;
};

/**
 * Starting a cohort.
 *
 * Only published courses are offered. A cohort on a draft course is a group of
 * learners waiting on material that can still change underneath them, and the
 * publish gate exists precisely so that does not happen.
 */
export function NewCohort({ courses }: { courses: CourseOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    createCohortAction,
    {},
  );

  const publishable = courses.filter((course) => course.status === "published");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--brand-primary)" }}
      >
        New cohort
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        New cohort
      </h2>

      {publishable.length === 0 ? (
        <>
          <p className="mt-3 text-sm">
            There are no published courses yet. A cohort runs against a
            published course, so that the material cannot change under a group
            already working through it.
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </>
      ) : (
        <form action={act} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">Course</span>
            <select name="courseId" required className={field}>
              {publishable.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                  {course.version ? ` (v${course.version})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Name</span>
            <input
              name="name"
              required
              minLength={2}
              placeholder="e.g. Intake 1, 2026"
              className={field}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Code{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input name="code" placeholder="e.g. HRM-2026-01" className={field} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Start date</span>
            <input name="startDate" type="date" required className={field} />
            <span className="block text-xs text-[var(--muted)]">
              Every deadline is counted from this day. It can be moved later,
              and everything moves with it.
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Expected end{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input name="endDate" type="date" className={field} />
          </label>

          {state.error ? (
            <p
              role="alert"
              className="sm:col-span-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
            >
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {pending ? "Creating…" : "Create cohort"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
