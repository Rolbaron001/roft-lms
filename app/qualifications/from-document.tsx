"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createFromDocumentAction,
  readCurriculumAction,
  type CreateFromDocumentState,
  type ReadingState,
} from "./actions";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge",
  practical: "Practical skill",
  workplace: "Work experience",
};

/** The three documents a qualification is founded on, in the order they matter. */
const SOURCES = [
  {
    name: "curriculum",
    label: "Curriculum Document",
    required: true,
    note: "The modules, topics and internal assessment criteria.",
  },
  {
    name: "qualification",
    label: "Qualification Document",
    required: false,
    note: "The SAQA registration extract. The only source of the SAQA ID and the Exit Level Outcomes.",
  },
  {
    name: "assessmentSpecification",
    label: "Assessment Specification",
    required: false,
    note: "The EISA specification. Filed and indexed so it is searchable.",
  },
] as const;

/**
 * Building a qualification out of the three documents that define it.
 *
 * Two steps, and the split is the point. The first reads the files and shows
 * what they say; the second writes it. Nothing exists in between, so a reading
 * that looks wrong is abandoned by closing the panel rather than by undoing a
 * half-made qualification.
 *
 * The files are held in one form across both steps — the read button and the
 * create button post the same form — so nothing is uploaded twice by the person
 * and nothing is parked on the server waiting to be come back to.
 */
export function FromDocument() {
  const [reading, read, readPending] = useActionState<ReadingState, FormData>(
    readCurriculumAction,
    {},
  );
  const [created, create, createPending] = useActionState<
    CreateFromDocumentState,
    FormData
  >(createFromDocumentAction, {});

  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const formRef = useRef<HTMLFormElement>(null);
  const held = useRef<Record<string, File>>({});

  /**
   * Puts the chosen files back after every render.
   *
   * React clears an uncontrolled form once a form action resolves, which here
   * empties all three file inputs the moment the read finishes — so the create
   * step that follows would post no documents at all, and be blocked by the
   * required-file validation with nothing on screen explaining why. Holding
   * the File objects and reattaching them is what makes the second step
   * possible without asking somebody to pick the same three files twice.
   */
  useEffect(() => {
    for (const [name, file] of Object.entries(held.current)) {
      const input = formRef.current?.querySelector<HTMLInputElement>(
        `input[name="${name}"]`,
      );
      if (!input || (input.files && input.files.length > 0)) continue;

      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--brand-primary)" }}
      >
        Build one from its documents
      </button>
    );
  }

  const found = reading.reading;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            From the qualification documents
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            These three are the foundation everything else is built on. Upload
            them and the App reads the qualification&rsquo;s details, its Exit
            Level Outcomes and its whole curriculum out of them. Check what it
            found, correct anything it got wrong, and it is written in one go.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Close
        </button>
      </div>

      {/* One form, two submit buttons: read, then create. */}
      <form ref={formRef} className="mt-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {SOURCES.map((source) => (
            <label key={source.name} className="block space-y-1.5">
              <span className="block text-sm font-medium">
                {source.label}
                {source.required ? null : (
                  <span className="font-normal text-[var(--muted)]">
                    {" "}
                    (recommended)
                  </span>
                )}
              </span>
              <input
                type="file"
                name={source.name}
                accept=".pdf,.docx,.doc"
                required={source.required}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    held.current[source.name] = file;
                  } else {
                    delete held.current[source.name];
                  }
                  setChosen({ ...chosen, [source.name]: file?.name ?? "" });
                }}
                className="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-2 file:py-1 file:text-xs"
              />
              <span className="block text-xs text-[var(--muted)]">
                {source.note}
              </span>
            </label>
          ))}
        </div>

        <button
          type="submit"
          formAction={read}
          disabled={readPending}
          className="mt-4 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {readPending ? "Reading…" : "Read them"}
        </button>

        {reading.error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {reading.error}
          </p>
        ) : null}

        {/* --- step two: check and confirm --- */}
        {found ? (
          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <p className="text-sm">
              Read <strong>{found.totals.modules} modules</strong>,{" "}
              {found.totals.topics} topics, {found.totals.elements} lines to
              teach and <strong>{found.totals.criteria} assessment criteria</strong>
              {found.totals.exitLevelOutcomes > 0 ? (
                <>
                  , plus{" "}
                  <strong>
                    {found.totals.exitLevelOutcomes} Exit Level Outcomes
                  </strong>{" "}
                  with {found.totals.associatedCriteria} associated criteria
                </>
              ) : null}
              .
            </p>

            {found.existing ? (
              <p
                role="alert"
                className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
              >
                <strong>{found.existing.title}</strong> already carries this
                code. Importing again would replace its whole curriculum, so
                this route will not do it. Open that qualification instead.
              </p>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="block text-sm font-medium">Title</span>
                <input
                  name="title"
                  required
                  minLength={3}
                  defaultValue={found.details.title ?? ""}
                  className={field}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  SAQA ID
                  {found.details.saqaId ? null : (
                    <span className="font-normal text-[var(--muted)]">
                      {" "}
                      (no Qualification Document supplied)
                    </span>
                  )}
                </span>
                <input
                  name="saqaId"
                  defaultValue={found.details.saqaId ?? ""}
                  className={`${field} font-mono`}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Curriculum code</span>
                <input
                  name="curriculumCode"
                  defaultValue={found.details.curriculumCode ?? ""}
                  className={`${field} font-mono`}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">NQF level</span>
                <input
                  name="nqfLevel"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={found.details.nqfLevel ?? ""}
                  className={field}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">Total credits</span>
                <input
                  name="totalCredits"
                  type="number"
                  min={0}
                  defaultValue={found.details.totalCredits ?? ""}
                  className={field}
                />
              </label>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">
                The {found.modules.length} modules it found
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                      <th className="pb-2">Module</th>
                      <th className="pb-2">Kind</th>
                      <th className="pb-2">Credits</th>
                      <th className="pb-2">Topics</th>
                      <th className="pb-2">To teach</th>
                      <th className="pb-2">Criteria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {found.modules.map((row) => (
                      <tr
                        key={row.code}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="py-2 pr-3">
                          <span className="font-mono text-xs">
                            {row.code}
                          </span>{" "}
                          {row.title}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {COMPONENT_LABELS[row.component] ??
                            row.component}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.credits ?? "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.topics}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.elements}
                        </td>
                        <td className="py-2 tabular-nums">
                          {row.component === "workplace"
                            ? "—"
                            : row.criteria}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {found.exitLevelOutcomes.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  The {found.exitLevelOutcomes.length} Exit Level Outcomes
                </summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {found.exitLevelOutcomes.map((outcome) => (
                    <li key={outcome.number}>
                      <span className="font-medium">ELO {outcome.number}.</span>{" "}
                      {outcome.description}
                      <span className="ml-1 text-xs text-[var(--muted)]">
                        ({outcome.criteria.length} associated criteria)
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {found.notes.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--brand-accent)]">
                  {found.notes.length} things to check
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                  {found.notes.map((note, index) => (
                    <li key={index}>· {note}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {created.error ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
              >
                {created.error}
              </p>
            ) : null}

            <button
              type="submit"
              formAction={create}
              disabled={createPending || Boolean(found.existing)}
              className="mt-5 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {createPending ? "Creating…" : "Create it, with this curriculum"}
            </button>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Every document you supplied is filed against the qualification, so
              a moderator can open the source of any criterion — and so the
              readiness gate is satisfied before material is authored.
            </p>
          </div>
        ) : null}
      </form>
    </section>
  );
}
