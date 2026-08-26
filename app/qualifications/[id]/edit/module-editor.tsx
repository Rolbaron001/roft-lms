"use client";

import { useActionState, useState } from "react";
import {
  addCriterionAction,
  addElementAction,
  addTopicAction,
  removeCriterionAction,
  removeElementAction,
  removeModuleAction,
  removeTopicAction,
  updateCriterionAction,
  updateElementAction,
  updateModuleAction,
  updateTopicAction,
  type EditorState,
} from "./actions";
import { ELEMENT_KINDS_BY_COMPONENT } from "@/lib/curriculum-shape";

const input =
  "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm";
const small = "text-xs text-[var(--muted)]";

type Element = { id: string; kind: string; code: string; description: string };
type Topic = {
  id: string;
  code: string;
  title: string;
  weightPercent: number | null;
  elements: Element[];
};
type Criterion = { id: string; code: string; description: string };

export type EditableModule = {
  id: string;
  component: string;
  code: string;
  title: string;
  credits: number | null;
  topics: Topic[];
  criteria: Criterion[];
};

/**
 * One module, and everything inside it.
 *
 * Every form here posts to a server action rather than holding a draft in the
 * browser. A curriculum is entered over hours, in pieces, often from a printed
 * page beside the keyboard — so each line is saved the moment it is entered
 * rather than accumulating into one edit that a closed tab would lose.
 */
export function ModuleEditor({
  qualificationId,
  module,
}: {
  qualificationId: string;
  module: EditableModule;
}) {
  const [open, setOpen] = useState(false);
  const kinds = ELEMENT_KINDS_BY_COMPONENT[module.component] ?? [];
  const takesCriteria = module.component !== "workplace";

  const weighted = module.topics.filter((t) => t.weightPercent !== null);
  const total = weighted.reduce((sum, t) => sum + (t.weightPercent ?? 0), 0);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="font-mono text-sm font-semibold">{module.code}</span>
          <span className="ml-3 text-sm">{module.title}</span>
          <span className={`ml-3 ${small}`}>
            {module.component.replace(/_/g, " ")}
            {module.credits !== null ? ` · ${module.credits} credits` : ""}
          </span>
        </span>
        <span className={small}>
          {module.topics.length} topics · {module.criteria.length} criteria
          {weighted.length === module.topics.length &&
          module.topics.length > 0 &&
          total !== 100
            ? ` · ${total}%`
            : ""}{" "}
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div className="space-y-6 border-t border-[var(--border)] px-5 py-5">
          <Row
            action={updateModuleAction}
            hidden={{ qualificationId, moduleId: module.id }}
            label="Rename this module"
          >
            <input name="code" defaultValue={module.code} className={`${input} w-44 font-mono`} aria-label="Module code" />
            <input name="title" defaultValue={module.title} className={`${input} min-w-48 flex-1`} aria-label="Module title" />
            <input
              name="credits"
              type="number"
              min={0}
              defaultValue={module.credits ?? ""}
              placeholder="credits"
              className={`${input} w-24`}
              aria-label="Credits"
            />
          </Row>

          {/* --- topics --- */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Topics
            </h3>

            <div className="mt-2 space-y-4">
              {module.topics.map((topic) => (
                <div
                  key={topic.id}
                  className="rounded-md border border-[var(--border)] p-3"
                >
                  <Row
                    action={updateTopicAction}
                    hidden={{ qualificationId, topicId: topic.id }}
                    remove={{
                      action: removeTopicAction,
                      hidden: { qualificationId, topicId: topic.id },
                      confirm: `Remove ${topic.code} and everything in it?`,
                    }}
                  >
                    <input name="code" defaultValue={topic.code} className={`${input} w-32 font-mono`} aria-label="Topic code" />
                    <input name="title" defaultValue={topic.title} className={`${input} min-w-48 flex-1`} aria-label="Topic title" />
                    <input
                      name="weightPercent"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={topic.weightPercent ?? ""}
                      placeholder="%"
                      className={`${input} w-20`}
                      aria-label="Percentage of the module"
                    />
                  </Row>

                  <ul className="mt-3 space-y-2 pl-3">
                    {topic.elements.map((element) => (
                      <li key={element.id}>
                        <Row
                          action={updateElementAction}
                          hidden={{ qualificationId, elementId: element.id }}
                          remove={{
                            action: removeElementAction,
                            hidden: { qualificationId, elementId: element.id },
                          }}
                        >
                          <input name="code" defaultValue={element.code} className={`${input} w-28 font-mono`} aria-label="Element code" />
                          <input
                            name="description"
                            defaultValue={element.description}
                            className={`${input} min-w-64 flex-1`}
                            aria-label="What must be taught"
                          />
                          <span className={small}>
                            {element.kind.replace(/_/g, " ")}
                          </span>
                        </Row>
                      </li>
                    ))}
                  </ul>

                  <Row
                    action={addElementAction}
                    hidden={{ qualificationId, topicId: topic.id }}
                    label="Add a line of what must be taught"
                    submit="Add"
                  >
                    <select name="kind" className={input} aria-label="Kind">
                      {kinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    <input name="code" placeholder="KT0101" required className={`${input} w-28 font-mono`} aria-label="Element code" />
                    <input
                      name="description"
                      placeholder="As the curriculum document words it"
                      required
                      className={`${input} min-w-64 flex-1`}
                      aria-label="Description"
                    />
                  </Row>
                </div>
              ))}
            </div>

            <Row
              action={addTopicAction}
              hidden={{ qualificationId, moduleId: module.id }}
              label="Add a topic"
              submit="Add topic"
            >
              <input name="code" placeholder="KM0101" required className={`${input} w-32 font-mono`} aria-label="Topic code" />
              <input name="title" placeholder="Title" required className={`${input} min-w-48 flex-1`} aria-label="Topic title" />
              <input
                name="weightPercent"
                type="number"
                min={0}
                max={100}
                placeholder="%"
                className={`${input} w-20`}
                aria-label="Percentage"
              />
            </Row>
          </div>

          {/* --- criteria --- */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Assessment criteria
            </h3>

            {!takesCriteria ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                A work experience module carries none. It is evidenced by a
                logbook the coach signs and an assessor accepts, so its work
                activities go in the topics above.
              </p>
            ) : (
              <>
                <ul className="mt-2 space-y-2">
                  {module.criteria.map((criterion) => (
                    <li key={criterion.id}>
                      <Row
                        action={updateCriterionAction}
                        hidden={{ qualificationId, criterionId: criterion.id }}
                        remove={{
                          action: removeCriterionAction,
                          hidden: {
                            qualificationId,
                            criterionId: criterion.id,
                          },
                        }}
                      >
                        <input name="code" defaultValue={criterion.code} className={`${input} w-28 font-mono`} aria-label="Criterion code" />
                        <input
                          name="description"
                          defaultValue={criterion.description}
                          className={`${input} min-w-64 flex-1`}
                          aria-label="What a learner must demonstrate"
                        />
                      </Row>
                    </li>
                  ))}
                </ul>

                <Row
                  action={addCriterionAction}
                  hidden={{ qualificationId, moduleId: module.id }}
                  label="Add a criterion"
                  submit="Add criterion"
                >
                  <input name="code" placeholder="IAC0101" required className={`${input} w-28 font-mono`} aria-label="Criterion code" />
                  <input
                    name="description"
                    placeholder="As the curriculum document words it"
                    required
                    className={`${input} min-w-64 flex-1`}
                    aria-label="Description"
                  />
                </Row>
              </>
            )}
          </div>

          <Row
            action={removeModuleAction}
            hidden={{ qualificationId, moduleId: module.id }}
            submit="Remove this module"
            danger
            confirm={`Remove ${module.code} and everything in it?`}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * One line that saves itself, with an optional delete beside it.
 *
 * The error is shown against the row that caused it rather than at the top of
 * the page: on a screen with forty rows, a message at the top tells you
 * something went wrong and not where.
 */
function Row({
  action,
  hidden,
  children,
  label,
  submit = "Save",
  remove,
  danger = false,
  confirm,
}: {
  action: (state: EditorState, formData: FormData) => Promise<EditorState>;
  hidden: Record<string, string>;
  children?: React.ReactNode;
  label?: string;
  submit?: string;
  remove?: {
    action: (state: EditorState, formData: FormData) => Promise<EditorState>;
    hidden: Record<string, string>;
    confirm?: string;
  };
  danger?: boolean;
  confirm?: string;
}) {
  const [state, act, pending] = useActionState<EditorState, FormData>(
    action,
    {},
  );

  return (
    <div className="mt-3">
      {label ? <p className={`mb-1 ${small}`}>{label}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <form
          action={act}
          className="flex flex-1 flex-wrap items-center gap-2"
          onSubmit={(event) => {
            if (confirm && !window.confirm(confirm)) event.preventDefault();
          }}
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {children}
          <button
            type="submit"
            disabled={pending}
            className={`rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50 ${
              danger
                ? "border border-[var(--danger)]/40 text-[var(--danger)]"
                : "border border-[var(--border)]"
            }`}
          >
            {pending ? "…" : submit}
          </button>
        </form>

        {remove ? <RemoveButton {...remove} /> : null}
      </div>

      {state.error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

function RemoveButton({
  action,
  hidden,
  confirm,
}: {
  action: (state: EditorState, formData: FormData) => Promise<EditorState>;
  hidden: Record<string, string>;
  confirm?: string;
}) {
  const [state, act, pending] = useActionState<EditorState, FormData>(
    action,
    {},
  );

  return (
    <span>
      <form
        action={act}
        onSubmit={(event) => {
          if (confirm && !window.confirm(confirm)) event.preventDefault();
        }}
      >
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-[var(--danger)]/40 px-2 py-1 text-xs text-[var(--danger)] disabled:opacity-50"
        >
          {pending ? "…" : "Remove"}
        </button>
      </form>
      {state.error ? (
        <p role="alert" className="mt-1 max-w-md text-xs text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
    </span>
  );
}
