"use client";

import { useActionState } from "react";
import { markItemAction, returnFeedbackAction, type MarkState } from "./actions";
import type { MarkedItem, MarkedPaper, RubricView } from "@/lib/marking";

/**
 * Marking a paper question by question.
 *
 * The learner's answer, the model answer and the rubric sit together on one
 * screen, because an assessor who has to hold the memorandum in another window
 * marks less consistently than one who does not. Each question saves on its
 * own: a fifty-mark paper is marked over an hour with interruptions, not in
 * one sitting, and losing half of it to a closed tab would be its own kind of
 * failure.
 */
export function MarkForm({
  paper,
  rubrics,
  criteria,
}: {
  paper: MarkedPaper;
  rubrics: Record<string, RubricView>;
  criteria: { id: string; code: string; description: string }[];
}) {
  const [state, mark, marking] = useActionState<MarkState, FormData>(
    markItemAction,
    {},
  );

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">{paper.assessmentTitle}</h2>
          <span className="text-sm tabular-nums">
            {paper.marksAwarded} of {paper.marksAvailable} marks
            <span className="ml-2 text-[var(--muted)]">
              ({Math.round(paper.percentage)}%, pass {paper.passMark}%)
            </span>
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {paper.purpose === "summative"
            ? "This is assessed. Once every question is marked, record a decision — the criteria it evidences are proposed for you to confirm."
            : "This is a workbook. It is developmental: mark it, then return feedback. Nothing here records competence or moves the learner towards eligibility."}
        </p>
        {!paper.fullyMarked ? (
          <p className="mt-2 text-sm">
            {paper.items.filter((item) => item.awarded === null).length}{" "}
            questions still to mark.
          </p>
        ) : null}
      </section>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {paper.items.map((item, index) => (
        <Question
          key={item.itemId}
          item={item}
          index={index}
          submissionId={paper.submissionId}
          rubric={item.rubricId ? rubrics[item.rubricId] : undefined}
          mark={mark}
          marking={marking}
          justMarked={state.marked === item.itemId}
        />
      ))}

      {paper.purpose === "formative" ? (
        <FeedbackPanel
          submissionId={paper.submissionId}
          criteria={criteria}
          fullyMarked={paper.fullyMarked}
        />
      ) : null}
    </div>
  );
}

function Question({
  item,
  index,
  submissionId,
  rubric,
  mark,
  marking,
  justMarked,
}: {
  item: MarkedItem;
  index: number;
  submissionId: string;
  rubric?: RubricView;
  mark: (formData: FormData) => void;
  marking: boolean;
  justMarked: boolean;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <span className="mr-2 tabular-nums text-[var(--muted)]">
            {index + 1}.
          </span>
          {item.stem}
        </h3>
        <span className="text-xs text-[var(--muted)]">
          {item.awarded === null
            ? `${item.points} marks · not marked`
            : `${item.awarded} of ${item.points}`}
          {justMarked ? " · saved" : ""}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            The answer
          </p>
          {item.options ? (
            <ul className="mt-2 space-y-1 text-sm">
              {item.options.map((option) => {
                const chosen = item.selectedOptionIds?.includes(option.id);
                const correct = item.correctOptionIds?.includes(option.id);
                return (
                  <li
                    key={option.id}
                    className={
                      chosen
                        ? correct
                          ? "text-[var(--success)]"
                          : "text-[var(--danger)]"
                        : correct
                          ? "text-[var(--muted)]"
                          : ""
                    }
                  >
                    {chosen ? "● " : "○ "}
                    {option.text}
                    {correct ? " — correct" : ""}
                  </li>
                );
              })}
            </ul>
          ) : item.answerText ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {item.answerText}
            </p>
          ) : (
            <p className="mt-2 text-sm italic text-[var(--muted)]">
              Left blank.
            </p>
          )}
        </div>

        {item.markingGuide ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Marking guidance
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
              {item.markingGuide}
            </p>
          </div>
        ) : null}
      </div>

      <form action={mark} className="mt-5 border-t border-[var(--border)] pt-4">
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="itemId" value={item.itemId} />

        {rubric ? (
          <div className="mb-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Marking matrix — choosing a level for each gives the mark
            </p>
            {rubric.dimensions.map((dimension) => (
              <label key={dimension.id} className="block text-sm">
                <span className="mb-1 block font-medium">{dimension.title}</span>
                <select
                  name={`level:${dimension.id}`}
                  defaultValue={item.chosenLevels?.[dimension.id] ?? ""}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  <option value="">Not yet judged</option>
                  {rubric.levels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label} ({level.minPercent}–{level.maxPercent}%)
                      {rubric.descriptors[`${dimension.id}:${level.id}`]
                        ? ` — ${rubric.descriptors[`${dimension.id}:${level.id}`].slice(0, 90)}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">
              Marks {rubric ? "(overrides the matrix)" : ""}
            </span>
            <input
              type="number"
              name="marks"
              step="0.5"
              min={0}
              max={item.points}
              defaultValue={item.awarded ?? ""}
              className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>

          <label className="min-w-64 flex-1 text-sm">
            <span className="mb-1 block font-medium">
              What the learner is told
            </span>
            <input
              name="comment"
              defaultValue={item.comment ?? ""}
              placeholder="Where it was strong, and what was missing."
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={marking}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium transition hover:bg-[var(--brand-accent)]/10 disabled:opacity-60"
          >
            {marking ? "Saving…" : "Save this mark"}
          </button>
        </div>
      </form>
    </section>
  );
}

function FeedbackPanel({
  submissionId,
  criteria,
  fullyMarked,
}: {
  submissionId: string;
  criteria: { id: string; code: string; description: string }[];
  fullyMarked: boolean;
}) {
  const [state, act, pending] = useActionState<MarkState, FormData>(
    returnFeedbackAction,
    {},
  );

  return (
    <section className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-5">
      <h2 className="text-base font-semibold">Return this workbook</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Feedback, not a decision. It tells the learner what to go back to before
        the summative, and it records no competence against any criterion.
      </p>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <form action={act} className="mt-4 space-y-3">
        <input type="hidden" name="submissionId" value={submissionId} />

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Comments</span>
          <textarea
            name="comments"
            rows={4}
            required
            placeholder="What was solid, and what to re-read before the summative."
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </label>

        {criteria.length > 0 ? (
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium">
              Criteria the weak answers cluster around
            </legend>
            <div className="space-y-1">
              {criteria.map((criterion) => (
                <label key={criterion.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="criteriaOfConcern"
                    value={criterion.id}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-mono text-xs">{criterion.code}</span>{" "}
                    {criterion.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <button
          type="submit"
          disabled={pending || !fullyMarked}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Returning…" : "Return to the learner"}
        </button>
        {!fullyMarked ? (
          <span className="ml-3 text-xs text-[var(--muted)]">
            Mark every question first.
          </span>
        ) : null}
      </form>
    </section>
  );
}
