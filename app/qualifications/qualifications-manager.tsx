"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  addCriterionAction,
  addModuleAction,
  createQualificationAction,
  type ActionState,
} from "./actions";

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge",
  practical: "Practical skill",
  workplace: "Workplace experience",
  general: "General",
};

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Module = {
  id: string;
  component: string;
  code: string;
  title: string;
  credits: number | null;
  criterionCount: number;
};

type Qualification = {
  id: string;
  title: string;
  qctoCode: string | null;
  saqaId: string | null;
  nqfLevel: number | null;
  totalCredits: number | null;
  modules: Module[];
};

/** What is inside, said on the row itself so it need not be opened to find out. */
function summarise(qualification: Qualification): string {
  if (qualification.modules.length === 0) return "No modules yet";

  const criteria = qualification.modules.reduce(
    (total, module) => total + module.criterionCount,
    0,
  );

  return `${qualification.modules.length} ${
    qualification.modules.length === 1 ? "module" : "modules"
  } · ${criteria} ${criteria === 1 ? "criterion" : "criteria"}`;
}

function Message({ state }: { state: ActionState }) {
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

export function QualificationsManager({
  qualifications,
}: {
  qualifications: Qualification[];
}) {
  const [createState, createAction, createPending] = useActionState<
    ActionState,
    FormData
  >(createQualificationAction, {});
  const [moduleState, moduleAction, modulePending] = useActionState<
    ActionState,
    FormData
  >(addModuleAction, {});
  const [criterionState, criterionAction, criterionPending] = useActionState<
    ActionState,
    FormData
  >(addCriterionAction, {});

  const [openModuleFor, setOpenModuleFor] = useState<string | null>(null);
  const [openCriterionFor, setOpenCriterionFor] = useState<string | null>(null);

  // Collapsed to start with. This page is the way in to every qualification a
  // provider offers, and a curriculum runs to a dozen modules — opened by
  // default, four qualifications bury the list of qualifications itself.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  function toggle(id: string) {
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {qualifications.map((qualification) => (
        <section
          key={qualification.id}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">
                <Link
                  href={`/qualifications/${qualification.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {qualification.title}
                </Link>
              </h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {[
                  qualification.qctoCode
                    ? `QCTO ${qualification.qctoCode}`
                    : null,
                  qualification.saqaId ? `SAQA ${qualification.saqaId}` : null,
                  qualification.nqfLevel
                    ? `NQF level ${qualification.nqfLevel}`
                    : null,
                  qualification.totalCredits
                    ? `${qualification.totalCredits} credits`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No statutory identifiers recorded"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => toggle(qualification.id)}
              aria-expanded={expanded.has(qualification.id)}
              aria-controls={`modules-${qualification.id}`}
              className="flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)]"
            >
              {summarise(qualification)}
              <span aria-hidden="true">
                {expanded.has(qualification.id) ? "▲" : "▼"}
              </span>
            </button>
          </div>

          <div id={`modules-${qualification.id}`} hidden={!expanded.has(qualification.id)}>
            {qualification.modules.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {qualification.modules.map((module) => (
                  <li
                    key={module.id}
                    className="rounded-md border border-[var(--border)] px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">
                        <span className="font-medium">{module.code}</span>{" "}
                        {module.title}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {COMPONENT_LABELS[module.component] ?? module.component}
                        {module.credits ? ` · ${module.credits} credits` : ""} ·{" "}
                        <Link
                          href={`/qualifications/${qualification.id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {module.criterionCount}{" "}
                          {module.criterionCount === 1 ? "criterion" : "criteria"}
                        </Link>
                      </span>
                    </div>

                    {openCriterionFor === module.id ? (
                      <form action={criterionAction} className="mt-3 space-y-2">
                        <input
                          type="hidden"
                          name="curriculumModuleId"
                          value={module.id}
                        />
                        <input
                          name="code"
                          required
                          placeholder="Criterion code, e.g. IAC-01"
                          className={inputClass}
                        />
                        <textarea
                          name="description"
                          required
                          rows={2}
                          placeholder="What the learner must demonstrate"
                          className={inputClass}
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={criterionPending}
                            className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                            style={{ background: "var(--brand-primary)" }}
                          >
                            {criterionPending ? "Adding…" : "Add criterion"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenCriterionFor(null)}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenCriterionFor(module.id)}
                        className="mt-2 text-sm font-medium text-[var(--brand-accent)] hover:underline"
                      >
                        + Add an assessment criterion
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No curriculum modules yet.
              </p>
            )}

            <div className="mt-3 space-y-2">
              <Message state={criterionState} />
              <Message state={moduleState} />
            </div>

            {openModuleFor === qualification.id ? (
              <form action={moduleAction} className="mt-4 space-y-2">
                <input
                  type="hidden"
                  name="qualificationId"
                  value={qualification.id}
                />
                <select name="component" defaultValue="knowledge" className={inputClass}>
                  <option value="knowledge">Knowledge module</option>
                  <option value="practical">Practical skill module</option>
                  <option value="workplace">Workplace experience module</option>
                  <option value="general">General (non-accredited)</option>
                </select>
                <input
                  name="code"
                  required
                  placeholder="Module code, e.g. KM-01"
                  className={inputClass}
                />
                <input
                  name="title"
                  required
                  placeholder="Module title"
                  className={inputClass}
                />
                <input
                  name="credits"
                  type="number"
                  min={0}
                  placeholder="Credits (optional)"
                  className={inputClass}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={modulePending}
                    className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--brand-primary)" }}
                  >
                    {modulePending ? "Adding…" : "Add module"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenModuleFor(null)}
                    className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setOpenModuleFor(qualification.id)}
                className="mt-3 text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                + Add a curriculum module
              </button>
            )}
          </div>
        </section>
      ))}

      <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          New qualification
        </h2>

        <div className="mt-3">
          <Message state={createState} />
        </div>

        <form action={createAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">Title</span>
            <input name="title" required minLength={3} className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              QCTO code{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input name="qctoCode" className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              SAQA ID{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input name="saqaId" className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">NQF level</span>
            <input
              name="nqfLevel"
              type="number"
              min={1}
              max={10}
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Total credits</span>
            <input
              name="totalCredits"
              type="number"
              min={0}
              className={inputClass}
            />
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createPending}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {createPending ? "Creating…" : "Create qualification"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
