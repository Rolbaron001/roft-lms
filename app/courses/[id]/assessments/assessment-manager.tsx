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
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";
import { Rich } from "@/components/rich-text";

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
  const t = useT();
  const [filter, setFilter] = useState("");
  const [ticked, setTicked] = useState(() => new Set(selected));
  const words = filter.trim().toLowerCase();

  return (
    <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-3">
      <legend className="px-1 text-xs font-medium">
        {t("courseAssess.assesses")}{" "}
        <span className="font-normal text-[var(--muted)]">
          {t("courseAssess.ticked", { ticked: ticked.size, count: criteria.length })}
        </span>
      </legend>
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("courseAssess.narrow")}
        aria-label={t("courseAssess.narrowLabel")}
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
  const t = useT();
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
          {question.points === 1
            ? t("courseAssess.markOne")
            : t("courseAssess.marks", { count: question.points })}
        </span>
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {codes.length > 0
          ? t("courseAssess.assessesCodes", { codes: codes.join(", ") })
          : t("courseAssess.noCriterion")}
        {editable && !editing ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="font-medium text-[var(--brand-accent)] hover:underline"
            >
              {t("courseAssess.change")}
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
              {pending ? t("common.saving") : t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              {t("courseAssess.close")}
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
  const t = useT();
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
        placeholder={t("courseAssess.question")}
        className={inputClass}
      />

      <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-3">
        <legend className="px-1 text-xs font-medium">{t("courseAssess.options")}</legend>

        {Array.from({ length: optionCount }).map((_, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="correct"
              value={index}
              aria-label={t("courseAssess.optionCorrect", { number: index + 1 })}
            />
            <input
              name="option"
              placeholder={t("courseAssess.option", { number: index + 1 })}
              className={inputClass}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={() => setOptionCount((count) => count + 1)}
          className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
        >
          {t("courseAssess.anotherOption")}
        </button>
      </fieldset>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">{t("courseAssess.marksLabel")}</span>
        <input
          name="points"
          type="number"
          min={0.01}
          step={0.01}
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
          {pending ? t("courseAssess.adding") : t("courseAssess.addQuestion")}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          {t("courseAssess.done")}
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
  const t = useT();
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
          {pending ? t("courseAssess.publishing") : t("courseAssess.publish")}
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
  const t = useT();
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
                  ? t("common.summative")
                  : t("common.formative")}{" "}
                ·{" "}
                {assessment.type === "workplace_logbook"
                  ? workplaceRecordWord
                  : (maybe(t, `courseAssess.type.${assessment.type}`) ?? assessment.type.replace(/_/g, " "))}{" "}
                · {t("courseAssess.passMark", { mark: assessment.passMark })} ·{" "}
                {assessment.moderationSampleRate >= 1
                  ? t("courseAssess.allModerated")
                  : t("courseAssess.sampleModerated", {
                      percent: Math.round(assessment.moderationSampleRate * 100),
                    })}{" "}
                ·{" "}
                {assessment.itemCount === 1
                  ? t("courseAssess.questionsOne")
                  : t("courseAssess.questions", { count: assessment.itemCount })}
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
                  {t("courseAssess.addAQuestion")}
                </button>
              )}

              <PublishForm courseId={courseId} assessmentId={assessment.id} />
            </>
          ) : (
            // "Learners can take this now" until 26 September, which was
            // not true of one that is on no step: nothing leads a learner to it.
            <p className="mt-3 text-sm text-[var(--muted)]">
              <Rich
                text={t("courseAssess.published")}
                parts={{
                  link: (
                    <a href={`/courses/${courseId}/steps`} className="underline underline-offset-2">
                      {t("courseAssess.publishedLink")}
                    </a>
                  ),
                }}
              />
            </p>
          )}
        </section>
      ))}

      <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {t("courseAssess.new")}
        </h2>

        <div className="mt-3">
          <Message state={createState} />
        </div>

        <form action={createAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="courseId" value={courseId} />

          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">{t("courseAssess.titleLabel")}</span>
            <input name="title" required minLength={3} className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("courseAssess.type")}</span>
            <select name="type" defaultValue="quiz" className={inputClass}>
              <option value="quiz">{t("courseAssess.typeQuiz")}</option>
              <option value="evidence_submission">{t("courseAssess.typeEvidence")}</option>
              <option value="practical_observation">{t("courseAssess.typePractical")}</option>
              <option value="workplace_logbook">{workplaceRecordWord}</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("courseAssess.purpose")}</span>
            <select
              name="purpose"
              defaultValue="formative"
              className={inputClass}
            >
              <option value="formative">{t("courseAssess.formative")}</option>
              <option value="summative">{t("courseAssess.summative")}</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("courseAssess.passMarkLabel")}</span>
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
            <span className="block text-sm font-medium">{t("courseAssess.sample")}</span>
            <select
              name="moderationSampleRate"
              defaultValue="0.25"
              className={inputClass}
            >
              <option value="0.25">{t("courseAssess.sampleDefault")}</option>
              <option value="0.5">50%</option>
              <option value="1">{t("courseAssess.sampleEvery")}</option>
              <option value="0">{t("courseAssess.sampleNone")}</option>
            </select>
            <span className="block text-xs text-[var(--muted)]">{t("courseAssess.sampleNote")}</span>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createPending}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {createPending ? t("courseAssess.creating") : t("courseAssess.create")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
