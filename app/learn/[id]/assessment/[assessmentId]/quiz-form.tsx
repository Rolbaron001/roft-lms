"use client";

import { useActionState } from "react";
import { submitQuizAction, type QuizState } from "../../../actions";

type Item = {
  id: string;
  stem: string;
  type: string;
  points: number;
  options: { id: string; text: string }[];
};

export function QuizForm({
  enrolmentId,
  assessmentId,
  items,
}: {
  enrolmentId: string;
  assessmentId: string;
  items: Item[];
}) {
  const [state, action, pending] = useActionState<QuizState, FormData>(
    submitQuizAction,
    {},
  );

  if (state.result) {
    const { score, maxScore, passed, awaitingAssessor } = state.result;
    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-medium">
          {awaitingAssessor
            ? "Submitted"
            : passed
              ? "Passed"
              : "Not passed this time"}
        </h2>
        <p className="mt-2 text-sm">
          You scored {score} out of {maxScore}.
        </p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          {awaitingAssessor
            ? "This assessment counts towards your qualification, so an assessor will review it and record the competency decision. You will see the result once that is done."
            : passed
              ? "This was practice, so the result is recorded against your learning but does not decide a qualification."
              : "This was practice. Review the material and try again."}
        </p>
        <a
          href={`/learn/${enrolmentId}`}
          className="mt-6 inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "var(--brand-primary)" }}
        >
          Back to the course
        </a>
      </section>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />

      {items.map((item, index) => {
        // A question with several correct answers takes checkboxes; one with a
        // single answer takes radio buttons, so the form itself signals how
        // many answers are expected.
        const multiple = item.type === "multiple_response";

        return (
          <fieldset
            key={item.id}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
          >
            <legend className="sr-only">Question {index + 1}</legend>
            <p className="text-sm font-medium">
              {index + 1}. {item.stem}
            </p>
            {multiple ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Select every answer that applies.
              </p>
            ) : null}

            <div className="mt-3 space-y-2">
              {item.options.map((option) => (
                <label key={option.id} className="flex items-start gap-2 text-sm">
                  <input
                    type={multiple ? "checkbox" : "radio"}
                    name={`item:${item.id}`}
                    value={option.id}
                    className="mt-1"
                  />
                  <span>{option.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? "Submitting…" : "Submit answers"}
      </button>
    </form>
  );
}
