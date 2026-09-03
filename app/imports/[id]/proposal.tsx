"use client";

import { useActionState, useState } from "react";
import {
  commitPlanAction,
  discardImportAction,
  type ImportActionState,
} from "../actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

const COMPONENT_LABEL: Record<string, string> = {
  knowledge: "Knowledge",
  practical: "Practical",
  workplace: "Work experience",
};

const TARGET_LABEL: Record<string, string> = {
  qualification: "the qualification",
  study_unit: "a study unit",
  library: "the document library",
};

export type PlanView = {
  source: string;
  qualification: {
    title: string;
    saqaId: string | null;
    curriculumCode: string | null;
    nqfLevel: number | null;
    credits: number | null;
  };
  modules: {
    component?: string;
    code?: string;
    title?: string;
    credits?: number | null;
    topics?: {
      code?: string | null;
      title?: string;
      elements?: string[];
      criteria?: string[];
    }[];
  }[];
  studyUnits: { code: string; title: string }[];
  documents: {
    path: string;
    filename: string;
    target: string;
    kind: string | null;
    category: string | null;
    studyUnitCode: string | null;
    title: string;
    version: string | null;
    because: string;
  }[];
  warnings: string[];
};

/**
 * The whole plan, on one screen, committed in one act.
 *
 * Warnings first and unmissable, because they are the part that matters: they
 * are where the model or the programme build says what it could not determine,
 * and a fabricated assessment criterion caught here is one nobody is assessed
 * against.
 *
 * Everything else is collapsed by default. Fifteen modules and sixty documents
 * expanded at once is a page nobody reads, and a review nobody finishes is not
 * a review.
 */
export function Proposal({
  jobId,
  status,
  plan,
  qualifications,
  target,
}: {
  jobId: string;
  status: string;
  plan: PlanView;
  qualifications: { id: string; title: string }[];
  /** Where this is going, decided when the folder was read. */
  target: {
    mode: string;
    qualificationId?: string;
    courseId?: string;
    learningPathId?: string;
  };
}) {
  const [state, action, committing] = useActionState<
    ImportActionState,
    FormData
  >(commitPlanAction, {});
  const [discardState, discardAction] = useActionState<
    ImportActionState,
    FormData
  >(discardImportAction, {});
  const [open, setOpen] = useState<string | null>("warnings");

  const live = status === "proposed";
  const error = state.error ?? discardState.error;

  const totals = plan.modules.reduce(
    (sum, module) => {
      const topics = module.topics ?? [];
      return {
        topics: sum.topics + topics.length,
        elements:
          sum.elements +
          topics.reduce((count, topic) => count + (topic.elements?.length ?? 0), 0),
        criteria:
          sum.criteria +
          topics.reduce((count, topic) => count + (topic.criteria?.length ?? 0), 0),
      };
    },
    { topics: 0, elements: 0, criteria: 0 },
  );

  const section = (key: string, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setOpen(open === key ? null : key)}
      className="flex w-full items-baseline justify-between border-b border-[var(--border)] py-2 text-left text-sm"
    >
      <span className="font-medium">{label}</span>
      <span className="text-[var(--muted)]">
        {count} {open === key ? "▴" : "▾"}
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {state.notice ? (
        <p className="rounded-md border border-[var(--border)] p-3 text-sm">
          {state.notice}
        </p>
      ) : null}

      <p className="text-sm text-[var(--muted)]">
        {plan.source === "blueprint"
          ? "Read from the folder's own blueprint file. The structure below is exactly what that file says — nothing was inferred, and no model was asked."
          : "Read from the documents by the model. Check it against the curriculum document before committing."}
      </p>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-[var(--muted)]">Qualification</dt>
        <dd className="font-medium">{plan.qualification.title || "Not stated"}</dd>
        {plan.qualification.saqaId ? (
          <>
            <dt className="text-[var(--muted)]">SAQA</dt>
            <dd>{plan.qualification.saqaId}</dd>
          </>
        ) : null}
        {plan.qualification.curriculumCode ? (
          <>
            <dt className="text-[var(--muted)]">Curriculum code</dt>
            <dd>{plan.qualification.curriculumCode}</dd>
          </>
        ) : null}
        <dt className="text-[var(--muted)]">Level and credits</dt>
        <dd>
          NQF {plan.qualification.nqfLevel ?? "?"} ·{" "}
          {plan.qualification.credits ?? "?"} credits
        </dd>
        <dt className="text-[var(--muted)]">Will create</dt>
        <dd>
          {plan.modules.length} modules, {totals.topics} topics,{" "}
          {totals.elements} elements, {totals.criteria} criteria,{" "}
          {plan.studyUnits.length} study units, {plan.documents.length} documents
        </dd>
      </dl>

      {/* --- warnings, first and open ------------------------------------- */}
      {plan.warnings.length > 0 ? (
        <div>
          {section("warnings", "Read this first", plan.warnings.length)}
          {open === "warnings" ? (
            <ul className="mt-2 space-y-2 text-sm">
              {plan.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* --- modules ------------------------------------------------------ */}
      <div>
        {section("modules", "Curriculum", plan.modules.length)}
        {open === "modules" ? (
          <ul className="mt-2 space-y-2 text-sm">
            {plan.modules.map((module) => {
              const topics = module.topics ?? [];
              return (
                <li key={module.code} className="flex flex-wrap gap-x-3">
                  <span className="font-mono text-xs">{module.code}</span>
                  <span>{module.title}</span>
                  <span className="text-[var(--muted)]">
                    {COMPONENT_LABEL[module.component ?? ""] ??
                      `component not stated`}
                    {module.credits ? ` · ${module.credits}cr` : ""} ·{" "}
                    {topics.length} topics ·{" "}
                    {topics.reduce(
                      (sum, topic) => sum + (topic.criteria?.length ?? 0),
                      0,
                    )}{" "}
                    criteria
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* --- documents ---------------------------------------------------- */}
      <div>
        {section("documents", "Documents", plan.documents.length)}
        {open === "documents" ? (
          <ul className="mt-2 space-y-2 text-sm">
            {plan.documents.map((document) => (
              <li key={document.path}>
                <p className="flex flex-wrap gap-x-3">
                  <span className="font-mono text-xs">{document.path}</span>
                  <span className="text-[var(--muted)]">
                    → {TARGET_LABEL[document.target] ?? document.target}
                    {document.studyUnitCode ? ` (${document.studyUnitCode})` : ""}
                    {document.kind ? ` as ${document.kind.replace(/_/g, " ")}` : ""}
                    {document.category ? ` as ${document.category}` : ""}
                  </span>
                </p>
                <p className="text-xs text-[var(--muted)]">{document.because}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* --- commit ------------------------------------------------------- */}
      {live ? (
        <form
          action={action}
          className="space-y-2 border-t border-[var(--border)] pt-4"
        >
          <input type="hidden" name="jobId" value={jobId} />

          {target.mode === "qualification" ? (
            <label className="block text-sm">
              <span className="text-[var(--muted)]">
                Into which qualification
              </span>
              <select
                name="qualificationId"
                required
                className={`${inputClass} mt-1 block w-full max-w-md`}
              >
                <option value="">Choose one</option>
                {qualifications.map((qualification) => (
                  <option key={qualification.id} value={qualification.id}>
                    {qualification.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            // Already decided: this folder was read from the thing it belongs
            // to, so asking again would only be a chance to get it wrong.
            <>
              <input
                type="hidden"
                name="qualificationId"
                value={target.qualificationId ?? ""}
              />
              <input
                type="hidden"
                name="courseId"
                value={target.courseId ?? ""}
              />
              <input
                type="hidden"
                name="learningPathId"
                value={target.learningPathId ?? ""}
              />
              <p className="text-sm text-[var(--muted)]">
                Filed against the{" "}
                {target.mode === "course"
                  ? "course"
                  : target.mode === "programme"
                    ? "programme"
                    : "qualification"}{" "}
                you started from.
              </p>
            </>
          )}

          <p className="max-w-2xl text-xs text-[var(--muted)]">
            Everything above goes in at once, through the same checks that apply
            to anything built by hand. Whatever those checks turn away is
            reported rather than skipped quietly.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={committing}
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {committing ? "Committing…" : "Commit all of it"}
            </button>
          </div>
        </form>
      ) : null}

      {live ? (
        <form action={discardAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <button type="submit" className={buttonClass}>
            Discard
          </button>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Kept on the record. What was proposed and rejected is how anybody
            judges whether the extension is worth having.
          </p>
        </form>
      ) : null}
    </div>
  );
}
