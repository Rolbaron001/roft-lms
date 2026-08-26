"use client";

import { useActionState, useState } from "react";
import { acceptModuleAction, type AcceptState } from "./actions";

type Element = { code: string; kind: string; description: string };
type Topic = {
  code: string;
  title: string;
  weightPercent: number | null;
  elements: Element[];
  criteria: { code: string; description: string }[];
};

export type ProposedModuleView = {
  code: string;
  component: string;
  title: string;
  credits: number | null;
  present: boolean;
  topicCount: number;
  elementCount: number;
  criterionCount: number;
  topics: Topic[];
};

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge module",
  practical: "Practical skills module",
  workplace: "Work experience module",
};

/**
 * One module as the document appears to describe it, with the option to take
 * it. Collapsed by default and expandable to every line, because "accept" is
 * only meaningful if the thing being accepted can be read first.
 */
export function AcceptModule({
  qualificationId,
  module,
}: {
  qualificationId: string;
  module: ProposedModuleView;
}) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState<AcceptState, FormData>(
    acceptModuleAction,
    {},
  );

  const taken = Boolean(state.done);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex-1 text-left"
          aria-expanded={open}
        >
          <span className="font-mono text-sm font-semibold">{module.code}</span>
          <span className="ml-3 text-sm">{module.title}</span>
          <span className="ml-3 block text-xs text-[var(--muted)] sm:mt-1">
            {COMPONENT_LABELS[module.component] ?? module.component}
            {module.credits !== null ? ` · ${module.credits} credits` : ""} ·{" "}
            {module.topicCount} topics · {module.elementCount} to teach
            {module.component === "workplace"
              ? " · evidenced by logbook"
              : ` · ${module.criterionCount} criteria`}{" "}
            {open ? "▲" : "▼"}
          </span>
        </button>

        {module.present ? (
          <span className="text-xs text-[var(--muted)]">Already added</span>
        ) : taken ? (
          <span className="text-xs text-[var(--success)]">Added</span>
        ) : (
          <form action={act}>
            <input type="hidden" name="qualificationId" value={qualificationId} />
            <input type="hidden" name="moduleCode" value={module.code} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? "Adding…" : "Take this module"}
            </button>
          </form>
        )}
      </div>

      {state.error ? (
        <p
          role="alert"
          className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {state.done ? (
        <div className="border-t border-[var(--border)] px-5 py-3 text-xs">
          <p>
            Added {state.done.topics} topics, {state.done.elements} lines to
            teach and {state.done.criteria} criteria.
          </p>
          {state.done.refused.length > 0 ? (
            <>
              <p className="mt-2 font-medium text-[var(--danger)]">
                {state.done.refused.length} lines were not added:
              </p>
              <ul className="mt-1 space-y-0.5 text-[var(--muted)]">
                {state.done.refused.map((reason, index) => (
                  <li key={index}>· {reason}</li>
                ))}
              </ul>
              <p className="mt-2 text-[var(--muted)]">
                Add these by hand on the curriculum screen.
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="space-y-4 border-t border-[var(--border)] px-5 py-4">
          {module.topics.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Nothing was read under this module. Taking it will create the
              module alone, and its topics can be added by hand.
            </p>
          ) : null}

          {module.topics.map((topic) => (
            <div key={topic.code}>
              <p className="text-sm font-medium">
                <span className="font-mono text-xs">{topic.code}</span>{" "}
                {topic.title}
                {topic.weightPercent !== null ? (
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {topic.weightPercent}%
                  </span>
                ) : null}
              </p>

              <ul className="mt-1 space-y-0.5 pl-4 text-xs text-[var(--muted)]">
                {topic.elements.map((element) => (
                  <li key={`${topic.code}-${element.code}`}>
                    <span className="font-mono">{element.code}</span>{" "}
                    {element.description}
                  </li>
                ))}
              </ul>

              {topic.criteria.length > 0 ? (
                <ul className="mt-1 space-y-0.5 border-l-2 border-[var(--border)] pl-4 text-xs">
                  {topic.criteria.map((criterion) => (
                    <li key={`${topic.code}-${criterion.code}`}>
                      <span className="font-mono">{criterion.code}</span>{" "}
                      {criterion.description}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
