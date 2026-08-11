"use client";

import { useActionState } from "react";
import {
  addCourseAction,
  enrolOnPathAction,
  moveCourseAction,
  publishPathAction,
  removeCourseAction,
  type PathState,
} from "../actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function Message({ state }: { state: PathState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="mt-3 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function PathEditor({
  pathId,
  status,
  steps,
  addableCourses,
  people,
  canAuthor,
  canPublish,
  canEnrol,
}: {
  pathId: string;
  status: string;
  steps: {
    courseId: string;
    title: string;
    status: string;
    requiresPrevious: boolean;
  }[];
  addableCourses: { id: string; title: string }[];
  people: { id: string; label: string }[];
  canAuthor: boolean;
  canPublish: boolean;
  canEnrol: boolean;
}) {
  const editable = canAuthor && status === "draft";

  const [addState, addAction, addPending] = useActionState<PathState, FormData>(
    addCourseAction,
    {},
  );
  const [publishState, publishAction, publishPending] = useActionState<
    PathState,
    FormData
  >(publishPathAction, {});
  const [enrolState, enrolAction, enrolPending] = useActionState<
    PathState,
    FormData
  >(enrolOnPathAction, {});

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            The sequence
          </h2>

          {steps.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              No courses yet. Add them in the order learners should take them.
            </p>
          ) : (
            <ol className="mt-4 space-y-2">
              {steps.map((step, index) => (
                <li
                  key={step.courseId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span
                        className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ background: "var(--brand-primary)" }}
                      >
                        {index + 1}
                      </span>
                      <span className="font-medium">{step.title}</span>
                    </p>
                    <p className="mt-1 pl-8 text-xs text-[var(--muted)]">
                      {index === 0
                        ? "Opens as soon as somebody joins the programme."
                        : step.requiresPrevious
                          ? "Opens when the step before it is finished."
                          : "Opens straight away, alongside the others."}
                      {step.status !== "published" ? (
                        <span className="ml-1 font-medium text-[var(--danger)]">
                          This course is not published.
                        </span>
                      ) : null}
                    </p>
                  </div>

                  {editable ? (
                    <div className="flex items-center gap-1">
                      <form action={moveCourseAction}>
                        <input type="hidden" name="pathId" value={pathId} />
                        <input
                          type="hidden"
                          name="courseId"
                          value={step.courseId}
                        />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          disabled={index === 0}
                          aria-label={`Move ${step.title} earlier`}
                          className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-30"
                        >
                          ↑
                        </button>
                      </form>
                      <form action={moveCourseAction}>
                        <input type="hidden" name="pathId" value={pathId} />
                        <input
                          type="hidden"
                          name="courseId"
                          value={step.courseId}
                        />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          disabled={index === steps.length - 1}
                          aria-label={`Move ${step.title} later`}
                          className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </form>
                      <form action={removeCourseAction}>
                        <input type="hidden" name="pathId" value={pathId} />
                        <input
                          type="hidden"
                          name="courseId"
                          value={step.courseId}
                        />
                        <button
                          type="submit"
                          className="ml-1 text-xs text-[var(--danger)] hover:underline"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <Message state={addState} />

          {editable ? (
            <form action={addAction} className="mt-4 space-y-2">
              <input type="hidden" name="pathId" value={pathId} />
              <div className="flex gap-2">
                <select name="courseId" defaultValue="" className={inputClass}>
                  <option value="">Add a course…</option>
                  {addableCourses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={addPending || addableCourses.length === 0}
                  className="whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
                >
                  {addPending ? "Adding…" : "Add"}
                </button>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="requiresPrevious"
                  defaultChecked
                  className="mt-1"
                />
                <span>
                  Locked until the step before it is finished
                  <span className="block text-xs text-[var(--muted)]">
                    Untick for a course that can be taken at any point in the
                    programme.
                  </span>
                </span>
              </label>

              {addableCourses.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  Every published course is already in this programme.
                </p>
              ) : null}
            </form>
          ) : null}

          {status === "published" && canAuthor ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              This programme is published and people are working through it, so
              its steps are fixed. Changing the order underneath somebody would
              alter what they had already been told to do.
            </p>
          ) : null}
        </section>
      </div>

      <aside className="space-y-6">
        {canPublish && status === "draft" ? (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <Message state={publishState} />
            <form action={publishAction} className="mt-2">
              <input type="hidden" name="pathId" value={pathId} />
              <button
                type="submit"
                disabled={publishPending}
                className="w-full rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--brand-primary)" }}
              >
                {publishPending ? "Checking…" : "Publish programme"}
              </button>
            </form>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Every course in it has to be published first.
            </p>
          </section>
        ) : null}

        {canEnrol && status === "published" ? (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Put somebody on it
            </h2>
            <Message state={enrolState} />

            <form action={enrolAction} className="mt-3 space-y-3">
              <input type="hidden" name="pathId" value={pathId} />

              <select name="userId" defaultValue="" className={inputClass}>
                <option value="">Choose someone…</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.label}
                  </option>
                ))}
              </select>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  Due date{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                </span>
                <input type="date" name="dueDate" className={inputClass} />
              </label>

              <button
                type="submit"
                disabled={enrolPending}
                className="w-full rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--brand-primary)" }}
              >
                {enrolPending ? "Adding…" : "Add to programme"}
              </button>
            </form>

            <p className="mt-2 text-xs text-[var(--muted)]">
              Only the first course opens. The rest arrive as each is finished.
            </p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
