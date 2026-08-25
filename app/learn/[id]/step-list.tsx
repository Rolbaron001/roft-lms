"use client";

import { useActionState } from "react";
import Link from "next/link";
import { openStepAction, type LearnState } from "../actions";
import type { StepView } from "@/lib/spine";

/**
 * The ordered walk through a study unit.
 *
 * A locked step is shown, not hidden — a learner who cannot see what is coming
 * cannot plan for it, and "there is nothing here" is a worse answer than "this
 * opens when you have handed in Workbook 2". The lock in this list is a
 * courtesy; the refusal that matters happens on the server.
 */
export function StepList({
  steps,
  enrolmentId,
  isOwn,
}: {
  steps: StepView[];
  enrolmentId: string;
  isOwn: boolean;
}) {
  const [state, open, pending] = useActionState<LearnState, FormData>(
    openStepAction,
    {},
  );

  const done = steps.filter((step) => step.state === "done").length;
  const next = steps.find((step) => step.open && step.state !== "done");

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Your way through
        </h2>
        <span className="text-xs text-[var(--muted)]">
          {done} of {steps.length} finished
        </span>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const isNext = next?.id === step.id;

          return (
            <li
              key={step.id}
              className={`rounded-md border px-4 py-3 ${
                isNext
                  ? "border-[var(--brand-accent)] bg-[var(--brand-accent)]/5"
                  : "border-[var(--border)]"
              } ${step.open ? "" : "opacity-70"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span className="mr-2 text-xs tabular-nums text-[var(--muted)]">
                      {index + 1}
                    </span>
                    {step.title}
                    {step.optional ? (
                      <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                        optional
                      </span>
                    ) : null}
                  </p>

                  {step.guidance ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {step.guidance}
                    </p>
                  ) : null}

                  {!step.open && step.blockedBy.length > 0 ? (
                    <p className="mt-1.5 text-xs text-[var(--muted)]">
                      Opens when {step.blockedBy.join("; and when ")}.
                    </p>
                  ) : null}

                  {step.overrideReason ? (
                    <p className="mt-1.5 text-xs text-[var(--brand-accent)]">
                      Opened for you by your facilitator:{" "}
                      {step.overrideReason}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <StepState step={step} />

                  {isOwn && step.open && step.state !== "done" ? (
                    step.kind === "assessment" ? (
                      <Link
                        href={`/learn/${enrolmentId}/assessment/${step.targetId}`}
                        className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
                        style={{ background: "var(--brand-primary)" }}
                      >
                        {step.progress.submitted ? "Review" : "Start"}
                      </Link>
                    ) : (
                      <form action={open}>
                        <input type="hidden" name="stepId" value={step.id} />
                        <input
                          type="hidden"
                          name="enrolmentId"
                          value={enrolmentId}
                        />
                        <button
                          type="submit"
                          disabled={pending}
                          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition hover:bg-[var(--brand-accent)]/10 disabled:opacity-60"
                        >
                          {step.progress.opened ? "Opened" : "Open"}
                        </button>
                      </form>
                    )
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepState({ step }: { step: StepView }) {
  const [label, tone] = !step.open
    ? ["Locked", "text-[var(--muted)] border-[var(--muted)]/30"]
    : step.state === "done"
      ? ["Done", "text-[var(--success)] border-[var(--success)]/40"]
      : step.state === "in_progress"
        ? ["In progress", "text-[var(--brand-accent)] border-[var(--brand-accent)]/40"]
        : ["Ready", "text-[var(--brand-accent)] border-[var(--brand-accent)]/40"];

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}
