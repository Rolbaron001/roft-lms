"use client";

import { useActionState } from "react";
import {
  submitFeedbackAction,
  type FeedbackActionState,
} from "@/app/feedback/actions";
import type { FeedbackQuestion } from "@/lib/feedback";

const SCALE = [
  { value: 1, label: "Strongly disagree" },
  { value: 2, label: "Disagree" },
  { value: 3, label: "Neither" },
  { value: 4, label: "Agree" },
  { value: 5, label: "Strongly agree" },
];

/**
 * The form a learner fills in.
 *
 * Plain radio buttons with the words on them rather than a row of numbers,
 * because "4" means nothing without being told what 4 is, and a learner
 * guessing at the scale is noise in the average.
 */
export function AnswerForm({
  requestId,
  questions,
}: {
  requestId: string;
  questions: FeedbackQuestion[];
}) {
  const [state, action, saving] = useActionState<FeedbackActionState, FormData>(
    submitFeedbackAction,
    {},
  );

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="requestId" value={requestId} />

      {questions.map((question) => (
        <fieldset key={question.key}>
          <legend className="text-sm font-medium">
            {question.prompt}
            {question.required ? null : (
              <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                optional
              </span>
            )}
          </legend>

          {question.kind === "rating" ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {SCALE.map((point) => (
                <label
                  key={point.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name={question.key}
                    value={point.value}
                    required={question.required}
                  />
                  {point.label}
                </label>
              ))}
            </div>
          ) : (
            <textarea
              name={question.key}
              rows={3}
              className="mt-2 block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
            />
          )}
        </fieldset>
      ))}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {saving ? "Sending…" : "Send my answers"}
      </button>
    </form>
  );
}
