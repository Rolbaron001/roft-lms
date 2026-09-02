"use client";

import { useActionState, useState } from "react";
import {
  commitModuleAction,
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

export type ProposedModule = {
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
};

/**
 * The proposal, module by module.
 *
 * Each module is committed on its own, into a qualification chosen here. A
 * single button that took the lot would be a button nobody can check before
 * pressing, and checking is the whole point: a model will produce something
 * plausible from a document that says nothing of the kind, and the only place
 * that gets caught is here.
 */
export function Proposal({
  jobId,
  status,
  modules,
  qualifications,
  problems,
  committed,
}: {
  jobId: string;
  status: string;
  modules: ProposedModule[];
  qualifications: { id: string; title: string }[];
  problems: string[];
  /** Module codes already taken from this proposal. */
  committed: string[];
}) {
  const [state, action, committing] = useActionState<
    ImportActionState,
    FormData
  >(commitModuleAction, {});
  const [discardState, discardAction] = useActionState<
    ImportActionState,
    FormData
  >(discardImportAction, {});
  const [expanded, setExpanded] = useState<string | null>(null);

  const open = status === "proposed";
  const error = state.error ?? discardState.error;

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      {problems.length > 0 ? (
        <div className="rounded-md border border-[var(--border)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            What it could not determine
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Read this before anything else. It is where the model says what the
            documents did not tell it, and a missing criterion here is one
            somebody would otherwise be assessed against without knowing.
          </p>
        </div>
      ) : null}

      {modules.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No modules were proposed.
        </p>
      ) : (
        <ul className="space-y-3">
          {modules.map((module) => {
            const code = module.code ?? "(no code)";
            const topics = module.topics ?? [];
            const criteria = topics.reduce(
              (sum, topic) => sum + (topic.criteria?.length ?? 0),
              0,
            );
            const elements = topics.reduce(
              (sum, topic) => sum + (topic.elements?.length ?? 0),
              0,
            );

            return (
              <li
                key={code}
                className="rounded-md border border-[var(--border)] p-3"
              >
                <p className="text-sm font-medium">
                  {code} · {module.title ?? "Untitled"}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {COMPONENT_LABEL[module.component ?? ""] ??
                      `component: ${module.component ?? "not stated"}`}
                    {module.credits ? ` · ${module.credits} credits` : ""}
                  </span>
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {topics.length} topics · {elements} elements · {criteria}{" "}
                  criteria
                </p>

                <button
                  type="button"
                  onClick={() =>
                    setExpanded(expanded === code ? null : code)
                  }
                  className="mt-2 text-xs underline"
                >
                  {expanded === code ? "Hide" : "Read what it proposes"}
                </button>

                {expanded === code ? (
                  <div className="mt-2 space-y-3 border-l-2 border-[var(--border)] pl-3">
                    {topics.map((topic, index) => (
                      <div key={index}>
                        <p className="text-sm font-medium">
                          {topic.code ? `${topic.code} · ` : ""}
                          {topic.title ?? "Untitled topic"}
                        </p>
                        {(topic.elements ?? []).length > 0 ? (
                          <ul className="mt-1 list-disc pl-5 text-sm">
                            {topic.elements?.map((element, position) => (
                              <li key={position}>{element}</li>
                            ))}
                          </ul>
                        ) : null}
                        {(topic.criteria ?? []).length > 0 ? (
                          <ul className="mt-1 list-disc pl-5 text-sm text-[var(--muted)]">
                            {topic.criteria?.map((criterion, position) => (
                              <li key={position}>{criterion}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {committed.includes(code) ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    Already added.
                  </p>
                ) : open && qualifications.length > 0 ? (
                  <form action={action} className="mt-3 flex flex-wrap gap-2">
                    <input type="hidden" name="jobId" value={jobId} />
                    <input type="hidden" name="moduleCode" value={code} />
                    <select
                      name="qualificationId"
                      required
                      className={inputClass}
                    >
                      <option value="">Into which qualification</option>
                      {qualifications.map((qualification) => (
                        <option key={qualification.id} value={qualification.id}>
                          {qualification.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={committing}
                      className={buttonClass}
                    >
                      {committing ? "Adding…" : "Add this module"}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <form action={discardAction} className="border-t border-[var(--border)] pt-4">
          <input type="hidden" name="jobId" value={jobId} />
          <button type="submit" className={buttonClass}>
            Discard this proposal
          </button>
          <p className="mt-2 text-xs text-[var(--muted)]">
            It stays on the record. What was proposed and rejected is the more
            interesting half.
          </p>
        </form>
      ) : null}
    </div>
  );
}
