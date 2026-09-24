"use client";

import { useActionState, useState } from "react";
import type { CourseSpine } from "@/lib/spine-editor";
import {
  addPrerequisiteAction,
  addStepAction,
  moveStepAction,
  removeStepAction,
  type SpineState,
} from "./actions";

const KIND_LABEL: Record<string, string> = {
  lesson: "Lesson",
  assessment: "Assessment",
  document: "Document",
  workplace: "Workplace",
};

const RULE_LABEL: Record<string, string> = {
  opened: "opened",
  submitted: "handed in",
  reviewed: "marked and returned",
  competent: "judged competent",
  signed_off: "signed off",
};

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm";

/**
 * Building the order a learner walks.
 *
 * Everything here posts to lib/spine.ts, which holds every rule. The screen
 * adds none of its own, so a gate refused here is refused everywhere.
 */
export function SpineEditor({ spine }: { spine: CourseSpine }) {
  const [addState, add, adding] = useActionState<SpineState, FormData>(
    addStepAction,
    {},
  );
  const [moveState, move] = useActionState<SpineState, FormData>(
    moveStepAction,
    {},
  );
  const [removeState, drop] = useActionState<SpineState, FormData>(
    removeStepAction,
    {},
  );
  const [gateState, gate] = useActionState<SpineState, FormData>(
    addPrerequisiteAction,
    {},
  );

  const [chosen, setChosen] = useState("");
  const [gating, setGating] = useState<string | null>(null);

  const order = spine.steps.map((step) => step.id).join(",");
  const byId = new Map(spine.steps.map((step) => [step.id, step]));
  const notice =
    addState.notice ?? moveState.notice ?? removeState.notice ?? gateState.notice;
  const error =
    addState.error ?? moveState.error ?? removeState.error ?? gateState.error;

  // The chosen thing decides which kind of step this becomes, so the two
  // travel together in one value rather than asking twice.
  const [kind, targetId] = chosen ? chosen.split(":") : ["", ""];

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p className="text-sm text-[var(--muted)]">{notice}</p>
      ) : null}

      {/* ---------------------------------------------------- what is on it */}
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          In this order
        </h2>

        {spine.steps.length === 0 ? (
          <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
            Nothing is on this course yet, so a learner enrolled on it would
            open it and find an empty page. Add the first thing below.
          </p>
        ) : (
          <ol className="space-y-2">
            {spine.steps.map((step, index) => (
              <li
                key={step.id}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">
                    <span className="text-[var(--muted)]">{index + 1}. </span>
                    <span className="text-xs text-[var(--muted)]">
                      {KIND_LABEL[step.kind] ?? step.kind}{" "}
                    </span>
                    <span className={step.ready ? "" : "text-[var(--danger)]"}>
                      {step.title}
                    </span>
                    {step.targetTitle ? (
                      <span className="text-xs text-[var(--muted)]">
                        {" "}
                        ({step.targetTitle})
                      </span>
                    ) : null}
                    {step.optional ? (
                      <span className="text-xs text-[var(--muted)]">
                        {" "}
                        optional
                      </span>
                    ) : null}
                  </span>

                  <span className="flex items-center gap-2">
                    {[
                      { direction: "up", label: "Up", at: index > 0 },
                      {
                        direction: "down",
                        label: "Down",
                        at: index < spine.steps.length - 1,
                      },
                    ].map(({ direction, label, at }) =>
                      at ? (
                        <form key={direction} action={move}>
                          <input type="hidden" name="courseId" value={spine.course.id} />
                          <input type="hidden" name="stepId" value={step.id} />
                          <input type="hidden" name="order" value={order} />
                          <input type="hidden" name="direction" value={direction} />
                          <button
                            type="submit"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                          >
                            {label}
                          </button>
                        </form>
                      ) : null,
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setGating(gating === step.id ? null : step.id)
                      }
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      Gate
                    </button>

                    <form action={drop}>
                      <input type="hidden" name="courseId" value={spine.course.id} />
                      <input type="hidden" name="stepId" value={step.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--danger)]"
                      >
                        Remove
                      </button>
                    </form>
                  </span>
                </div>

                {step.note ? (
                  <p className="mt-1 text-xs text-[var(--danger)]">{step.note}</p>
                ) : null}
                {step.guidance ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {step.guidance}
                  </p>
                ) : null}

                {step.prerequisites.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Waits for{" "}
                    {step.prerequisites
                      .map((one) => {
                        const required = byId.get(one.requiredStepId);
                        return `${required?.title ?? "a step"} to be ${RULE_LABEL[one.rule] ?? one.rule}`;
                      })
                      .join(", and ")}
                    .
                  </p>
                ) : step.release === "open" ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Open from the start.
                  </p>
                ) : index > 0 ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Waits for the step before it to be{" "}
                    {RULE_LABEL[step.sequentialRule] ?? step.sequentialRule}.
                  </p>
                ) : null}

                {gating === step.id ? (
                  <form
                    action={gate}
                    className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3"
                  >
                    <input type="hidden" name="courseId" value={spine.course.id} />
                    <input type="hidden" name="stepId" value={step.id} />
                    <span className="text-xs text-[var(--muted)]">
                      Hold this shut until
                    </span>
                    <select name="requiredStepId" className={inputClass} required>
                      <option value="">Choose a step…</option>
                      {spine.steps
                        .filter((other) => other.id !== step.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.title}
                          </option>
                        ))}
                    </select>
                    <span className="text-xs text-[var(--muted)]">is</span>
                    <select name="rule" className={inputClass} defaultValue="opened">
                      {Object.entries(RULE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                      style={{ background: "var(--brand-primary)" }}
                    >
                      Add the gate
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ------------------------------------------------------ adding one */}
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <h2 className="mb-1 text-sm font-semibold">Add a step</h2>

        {spine.choices.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            Everything held against this course is already on the list. Capture
            a workbook or file a document against it, and it will appear here.
          </p>
        ) : (
          <form action={add} className="space-y-3">
            <input type="hidden" name="courseId" value={spine.course.id} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="targetId" value={targetId} />

            <label className="block text-sm">
              <span className="mb-1 block text-xs text-[var(--muted)]">
                What the learner meets
              </span>
              <select
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                className={`${inputClass} w-full max-w-xl`}
                required
              >
                <option value="">Choose…</option>
                {(["assessment", "lesson", "document", "workplace"] as const).map(
                  (group) => {
                    const inGroup = spine.choices.filter(
                      (choice) => choice.kind === group,
                    );
                    if (inGroup.length === 0) return null;
                    return (
                      <optgroup key={group} label={KIND_LABEL[group]}>
                        {inGroup.map((choice) => (
                          <option
                            key={choice.id}
                            value={`${choice.kind}:${choice.id}`}
                          >
                            {choice.title}
                            {choice.detail ? ` (${choice.detail})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    );
                  },
                )}
              </select>
            </label>

            {/*
              What adding this one would mean today, said before it is added
              rather than discovered on the preview afterwards.
            */}
            {chosen
              ? spine.choices
                  .filter(
                    (choice) => `${choice.kind}:${choice.id}` === chosen,
                  )
                  .map((choice) =>
                    choice.warning ? (
                      <p
                        key={choice.id}
                        className="text-xs text-[var(--danger)]"
                      >
                        {choice.warning}
                      </p>
                    ) : null,
                  )
              : null}

            <div className="flex flex-wrap gap-3">
              <input
                name="title"
                placeholder="Call it something else (optional)"
                className={`${inputClass} min-w-64 flex-1`}
              />
              <input
                name="guidance"
                placeholder="One line of context (optional)"
                className={`${inputClass} min-w-64 flex-1`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="optional" />
                A learner may skip it
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="release" value="open" />
                Open from the start, rather than after the step before it
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-xs text-[var(--muted)]">
                  The step before must be
                </span>
                <select
                  name="sequentialRule"
                  defaultValue="opened"
                  className={inputClass}
                >
                  {Object.entries(RULE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={adding || !chosen}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--brand-primary)" }}
            >
              {adding ? "Adding…" : "Add it to the end"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
