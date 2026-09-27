"use client";

import { useActionState, useState } from "react";
import {
  addQuestionAction,
  createAssessmentAction,
  publishAssessmentAction,
  setQuestionCriteriaAction,
  type AssessmentState,
} from "./actions";
// From ui, not app-shell: app-shell reads the database for the notification
// count, and importing it here would pull the Postgres driver into the
// browser bundle.
import { StatusBadge } from "@/components/ui";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Assessment = {
  id: string;
  title: string;
  type: string;
  purpose: string;
  status: string;
  passMark: number;
  moderationSampleRate: number;
  itemCount: number;
};

type Criterion = {
  id: string;
  code: string;
  description: string;
  moduleCode: string;
  /** Its topic's code, or its module's where it has no topic. */
  place: string;
};

type Question = {
  id: string;
  assessmentId: string;
  stem: string;
  points: number;
  criterionIds: string[];
};

/**
 * Ticks for the criteria a question assesses, from the course's own.
 *
 * A study unit's course can answer to forty criteria or more, so the list
 * scrolls and can be narrowed by typing. Narrowing hides a row rather than
 * removing it, so a criterion already ticked is still sent.
 */
function CriteriaPicker({
  criteria,
  selected = [],
}: {
  criteria: Criterion[];
  selected?: string[];
}) {
  const [filter, setFilter] = useState("");
  const [ticked, setTicked] = useState(() => new Set(selected));
  const words = filter.trim().toLowerCase();

  return (
    <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-3">
      <legend className="px-1 text-xs font-medium">
        What this question assesses{" "}
        <span className="font-normal text-[var(--muted)]">
          ({ticked.size} of {criteria.length} ticked)
        </span>
      </legend>
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Narrow by code or wording"
        aria-label="Narrow the criteria"
        className={inputClass}
      />
      <div className="max-h-60 space-y-1 overflow-y-auto">
        {criteria.map((criterion) => {
          const shown =
            words === "" ||
            `${criterion.moduleCode} ${criterion.place} ${criterion.code} ${criterion.description}`
              .toLowerCase()
              .includes(words);
          return (
            <label
              key={criterion.id}
              className={`${shown ? "flex" : "hidden"} items-start gap-2 text-sm`}
            >
              <input
                type="checkbox"
                name="criterionId"
                value={criterion.id}
                checked={ticked.has(criterion.id)}
                onChange={(event) =>
                  setTicked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(criterion.id);
                    else next.delete(criterion.id);
                    return next;
                  })
                }
                className="mt-1"
              />
              <span>
                {/* Where it sits as well: the code alone cannot tell apart
                    the several IAC0104s a study unit can hold. */}
                <span className="font-mono text-xs">
                  {criterion.place} {criterion.code}
                </span>{" "}
                <span className="text-[var(--muted)]">
                  {criterion.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function QuestionRow({
  courseId,
  question,
  number,
  criteria,
  editable,
}: {
  courseId: string;
  question: Question;
  number: number;
  criteria: Criterion[];
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<AssessmentState, FormData>(
    setQuestionCriteriaAction,
    {},
  );
  const codes = criteria
    .filter((criterion) => question.criterionIds.includes(criterion.id))
    .map((criterion) => `${criterion.place} ${criterion.code}`);

  return (
    <li className="rounded-md border border-[var(--border)] px-4 py-3 text-sm">
      <p>
        {number}. {question.stem}{" "}
        <span className="text-xs text-[var(--muted)]">
          ({question.points} {question.points === 1 ? "mark" : "marks"})
        </span>
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {codes.length > 0 ? `Assesses ${codes.join(", ")}` : "Linked to no criterion"}
        {editable && !editing ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="font-medium text-[var(--brand-accent)] hover:underline"
            >
              Change
            </button>
          </>
        ) : null}
      </p>
      {editing ? (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="courseId" value={courseId} />
          <input type="hidden" name="itemId" value={question.id} />
          <CriteriaPicker criteria={criteria} selected={question.criterionIds} />
          <Message state={state} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              Close
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function Message({ state }: { state: AssessmentState }) {
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

function QuestionForm({
  courseId,
  assessmentId,
  criteria,
  onDone,
}: {
  courseId: string;
  assessmentId: string;
  criteria: Criterion[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<AssessmentState, FormData>(
    addQuestionAction,
    {},
  );
  const [optionCount, setOptionCount] = useState(3);

  // Counts the questions added, adjusted during render when a new result
  // arrives (React's pattern for state that follows another's changes).
  const [added, setAdded] = useState(0);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.notice) setAdded(added + 1);
  }

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />

      <textarea
        name="stem"
        required
        rows={2}
        placeholder="The question"
        className={inputClass}
      />

      <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-3">
        <legend className="px-1 text-xs font-medium">
          Answer options — tick every one that is correct
        </legend>

        {Array.from({ length: optionCount }).map((_, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="correct"
              value={index}
              aria-label={`Option ${index + 1} is correct`}
            />
            <input
              name="option"
              placeholder={`Option ${index + 1}`}
              className={inputClass}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={() => setOptionCount((count) => count + 1)}
          className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
        >
          + Another option
        </button>
      </fieldset>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Marks</span>
        <input
          name="points"
          type="number"
          min={1}
          defaultValue={1}
          className={inputClass}
        />
      </label>

      {criteria.length > 0 ? (
        // A fresh picker for each question added, so the ticks clear.
        <CriteriaPicker key={added} criteria={criteria} />
      ) : null}

      <Message state={state} />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Adding…" : "Add question"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Done
        </button>
      </div>
    </form>
  );
}

function PublishForm({
  courseId,
  assessmentId,
}: {
  courseId: string;
  assessmentId: string;
}) {
  const [state, action, pending] = useActionState<AssessmentState, FormData>(
    publishAssessmentAction,
    {},
  );

  return (
    <div className="mt-3">
      <Message state={state} />
      <form action={action} className="mt-2">
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="assessmentId" value={assessmentId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Publishing…" : "Publish assessment"}
        </button>
      </form>
    </div>
  );
}

export function AssessmentManager({
  /** What this provider calls a workplace experience sign-off. */
  workplaceRecordWord,
  courseId,
  assessments,
  criteria,
  questions,
}: {
  workplaceRecordWord: string;
  courseId: string;
  assessments: Assessment[];
  /** The criteria this course answers to; empty for training outside a curriculum. */
  criteria: Criterion[];
  questions: Question[];
}) {
  const [createState, createAction, createPending] = useActionState<
    AssessmentState,
    FormData
  >(createAssessmentAction, {});

  const [openQuestionFor, setOpenQuestionFor] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {assessments.map((assessment) => (
        <section
          key={assessment.id}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">{assessment.title}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {assessment.purpose === "summative"
                  ? "Summative"
                  : "Formative"}{" "}
                · {assessment.type.replace(/_/g, " ")} · pass mark{" "}
                {assessment.passMark}% ·{" "}
                {assessment.moderationSampleRate >= 1
                  ? "every decision moderated"
                  : `${Math.round(assessment.moderationSampleRate * 100)}% moderated`}{" "}
                · {assessment.itemCount}{" "}
                {assessment.itemCount === 1 ? "question" : "questions"}
              </p>
            </div>
            <StatusBadge status={assessment.status} />
          </div>

          {questions.some((question) => question.assessmentId === assessment.id) ? (
            <ol className="mt-4 space-y-2">
              {questions
                .filter((question) => question.assessmentId === assessment.id)
                .map((question, index) => (
                  <QuestionRow
                    key={question.id}
                    courseId={courseId}
                    question={question}
                    number={index + 1}
                    criteria={criteria}
                    editable={assessment.status === "draft" && criteria.length > 0}
                  />
                ))}
            </ol>
          ) : null}

          {assessment.status === "draft" ? (
            <>
              {openQuestionFor === assessment.id ? (
                <QuestionForm
                  courseId={courseId}
                  assessmentId={assessment.id}
                  criteria={criteria}
                  onDone={() => setOpenQuestionFor(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenQuestionFor(assessment.id)}
                  className="mt-3 text-sm font-medium text-[var(--brand-accent)] hover:underline"
                >
                  + Add a question
                </button>
              )}

              <PublishForm courseId={courseId} assessmentId={assessment.id} />
            </>
          ) : (
            // "Learners can take this now" until 26 September, which was
            // not true of one that is on no step: nothing leads a learner to it.
            <p className="mt-3 text-sm text-[var(--muted)]">
              Published. A learner meets it once it is a step in{" "}
              <a
                href={`/courses/${courseId}/steps`}
                className="underline underline-offset-2"
              >
                what a learner works through
              </a>
              .
            </p>
          )}
        </section>
      ))}

      <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          New assessment
        </h2>

        <div className="mt-3">
          <Message state={createState} />
        </div>

        <form action={createAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="courseId" value={courseId} />

          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">Title</span>
            <input name="title" required minLength={3} className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Type</span>
            <select name="type" defaultValue="quiz" className={inputClass}>
              <option value="quiz">Quiz — marked automatically</option>
              <option value="evidence_submission">
                Evidence — learner uploads work
              </option>
              <option value="practical_observation">
                Practical observation
              </option>
              <option value="workplace_logbook">{workplaceRecordWord}</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Purpose</span>
            <select
              name="purpose"
              defaultValue="formative"
              className={inputClass}
            >
              <option value="formative">
                Formative — practice, not counted
              </option>
              <option value="summative">
                Summative — counts, always moderated
              </option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Pass mark (%)</span>
            <input
              name="passMark"
              type="number"
              min={0}
              max={100}
              defaultValue={70}
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Moderation sample
            </span>
            <select
              name="moderationSampleRate"
              defaultValue="0.25"
              className={inputClass}
            >
              <option value="0.25">25% — platform default</option>
              <option value="0.5">50%</option>
              <option value="1">Every decision</option>
              <option value="0">None</option>
            </select>
            <span className="block text-xs text-[var(--muted)]">
              A floor, not a ceiling. Cohort size raises it: a cohort of ten or
              fewer is moderated in full and one of twenty or fewer at half,
              because a quarter of eight scripts is two, and two say almost
              nothing about an assessor&rsquo;s judgement. This figure governs
              cohorts above twenty. Ignored for a summative assessment, where
              every decision is moderated, and a newly registered assessor is
              always moderated in full.
            </span>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createPending}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {createPending ? "Creating…" : "Create assessment"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
