"use client";

import { useActionState, useState } from "react";
import {
  addQuestionAction,
  createAssessmentAction,
  publishAssessmentAction,
  type AssessmentState,
} from "./actions";
import { StatusBadge } from "@/components/app-shell";

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
  onDone,
}: {
  courseId: string;
  assessmentId: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<AssessmentState, FormData>(
    addQuestionAction,
    {},
  );
  const [optionCount, setOptionCount] = useState(3);

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
  courseId,
  assessments,
}: {
  courseId: string;
  assessments: Assessment[];
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

          {assessment.status === "draft" ? (
            <>
              {openQuestionFor === assessment.id ? (
                <QuestionForm
                  courseId={courseId}
                  assessmentId={assessment.id}
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
            <p className="mt-3 text-sm text-[var(--muted)]">
              Published. Learners can take this now.
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
              <option value="workplace_logbook">Workplace logbook</option>
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
              <option value="0.25">25% — the QCTO baseline</option>
              <option value="0.5">50%</option>
              <option value="1">Every decision</option>
              <option value="0">None</option>
            </select>
            <span className="block text-xs text-[var(--muted)]">
              Ignored for a summative assessment, where every decision is
              moderated. A newly registered assessor is always moderated in
              full.
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
