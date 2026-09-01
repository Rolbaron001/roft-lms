"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import {
  saveQuizDraftAction,
  submitQuizAction,
  type QuizState,
} from "../../../actions";

type Item = {
  id: string;
  stem: string;
  type: string;
  points: number;
  options: { id: string; text: string }[];
  /** The left column of a matching item. */
  matchPrompts?: { id: string; text: string }[] | null;
};

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

/** Types whose answer is prose rather than a choice. */
const WRITTEN = new Set(["short_answer", "long_answer", "scenario"]);

export function QuizForm({
  enrolmentId,
  assessmentId,
  items,
  savedAnswers,
}: {
  enrolmentId: string;
  assessmentId: string;
  items: Item[];
  /** Whatever was kept the last time this was saved. */
  savedAnswers?: Record<string, string[]>;
}) {
  const [state, action, pending] = useActionState<QuizState, FormData>(
    submitQuizAction,
    {},
  );

  const formRef = useRef<HTMLFormElement>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Keeps the answers a few seconds after the learner stops.
   *
   * Debounced rather than saved on every keystroke: a workbook answer is a
   * paragraph, and a request per character would be a great deal of traffic to
   * record the same paragraph a hundred times. Saving on blur alone is not
   * enough either, because a browser closed mid-sentence never blurs.
   */
  const keep = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const form = formRef.current;
      if (!form) return;
      setSaving(true);
      try {
        const result = await saveQuizDraftAction({}, new FormData(form));
        if (result.savedAt) setSavedAt(result.savedAt);
      } catch {
        // A failed save is not worth interrupting the learner for: the next
        // one will carry the same answers, and submitting does not depend on
        // any of them having succeeded.
      } finally {
        setSaving(false);
      }
    }, 2000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

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

  const answered = (itemId: string) => savedAnswers?.[itemId] ?? [];
  const writtenAnswer = (itemId: string) =>
    savedAnswers?.[`text:${itemId}`]?.[0] ?? "";

  return (
    <form
      ref={formRef}
      action={action}
      onChange={keep}
      className="space-y-4"
    >
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />

      {items.map((item, index) => {
        // A question with several correct answers takes checkboxes; one with a
        // single answer takes radio buttons, so the form itself signals how
        // many answers are expected.
        const multiple = item.type === "multiple_response";
        const justified = item.type === "true_false_justified";
        const matching = item.type === "matching";
        const written = WRITTEN.has(item.type);
        const chosen = answered(item.id);

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
            {matching ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Pair each item on the left with one on the right.
              </p>
            ) : null}

            {matching ? (
              <div className="mt-3 space-y-2">
                {(item.matchPrompts ?? []).map((prompt) => {
                  const existing = chosen
                    .map((pair) => pair.split(":"))
                    .find(([promptId]) => promptId === prompt.id);

                  return (
                    <label
                      key={prompt.id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="min-w-48 flex-1">{prompt.text}</span>
                      <select
                        name={`item:${item.id}`}
                        defaultValue={
                          existing ? `${prompt.id}:${existing[1]}` : ""
                        }
                        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                      >
                        <option value="">Choose…</option>
                        {item.options.map((option) => (
                          <option
                            key={option.id}
                            value={`${prompt.id}:${option.id}`}
                          >
                            {option.text}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : written ? (
              <textarea
                name={`text:${item.id}`}
                defaultValue={writtenAnswer(item.id)}
                rows={item.type === "short_answer" ? 3 : 10}
                className={`mt-3 ${inputClass}`}
                placeholder="Your answer"
              />
            ) : (
              <div className="mt-3 space-y-2">
                {item.options.map((option) => (
                  <label
                    key={option.id}
                    className="flex items-start gap-2 text-sm"
                  >
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={`item:${item.id}`}
                      value={option.id}
                      defaultChecked={chosen.includes(option.id)}
                      className="mt-1"
                    />
                    <span>{option.text}</span>
                  </label>
                ))}
              </div>
            )}

            {justified ? (
              <div className="mt-3">
                <label
                  htmlFor={`justify-${item.id}`}
                  className="block text-sm font-medium"
                >
                  Why?
                </label>
                <p className="mb-2 text-xs text-[var(--muted)]">
                  The reason is what is marked here, not the box above.
                </p>
                <textarea
                  id={`justify-${item.id}`}
                  name={`text:${item.id}`}
                  defaultValue={writtenAnswer(item.id)}
                  rows={4}
                  className={inputClass}
                />
              </div>
            ) : null}
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

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Submitting…" : "Submit answers"}
        </button>
        <span className="text-xs text-[var(--muted)]">
          {saving
            ? "Saving…"
            : savedAt
              ? `Your answers were kept at ${new Date(savedAt).toLocaleTimeString()}. Submitting is what sends them to be marked.`
              : "Your answers are kept as you work. Submitting is what sends them to be marked."}
        </span>
      </div>
    </form>
  );
}
