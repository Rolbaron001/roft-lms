"use client";

import { useActionState, useState } from "react";
import { commitCaptureAction, type CaptureState } from "../actions";
import type { ParsedPaper, ParsedItem } from "@/lib/capture-parse";
import type { Classified } from "@/lib/capture";

/**
 * Confirming — and correcting — what was read out of a Word document.
 *
 * Everything the parser produced is editable here. A wrong correct answer used
 * to mean going back to Word and uploading again; now it is a dropdown. The
 * findings come first and the commit sits below them, because that is the
 * order the reviewer should work in, and where anything is still outstanding
 * going on requires saying so explicitly.
 *
 * Confirming accepts responsibility for every correct answer in the paper,
 * which is why it needs `assessment:author` and why the name is recorded.
 */
export function ReviewForm({
  jobId,
  proposal,
  classified,
  assessments,
  criteria,
}: {
  jobId: string;
  proposal: ParsedPaper;
  classified: Classified | null;
  assessments: { id: string; title: string; purpose: string }[];
  criteria: { id: string; code: string }[];
}) {
  const [state, commit, committing] = useActionState<CaptureState, FormData>(
    commitCaptureAction,
    {},
  );
  const [paper, setPaper] = useState<ParsedPaper>(proposal);
  const [acknowledged, setAcknowledged] = useState(false);
  const [edited, setEdited] = useState(false);

  function updateItem(
    sectionIndex: number,
    itemIndex: number,
    change: Partial<ParsedItem>,
  ) {
    setEdited(true);
    setPaper((current) => {
      const sections = current.sections.map((section, s) =>
        s !== sectionIndex
          ? section
          : {
              ...section,
              items: section.items.map((item, i) =>
                i !== itemIndex ? item : { ...item, ...change },
              ),
            },
      );
      return { ...current, sections };
    });
  }

  const allItems = paper.sections.flatMap((section) => section.items);
  const byApp = allItems.filter((item) => item.markedBy === "app");
  const marks = allItems.reduce((sum, item) => sum + (item.points ?? 0), 0);

  // Recomputed as the reviewer corrects, so a fault they have just fixed stops
  // being shown — otherwise the list stays red and stops meaning anything.
  const outstanding: string[] = [];
  for (const section of paper.sections) {
    for (const item of section.items) {
      if (item.markedBy === "app" && item.correctIndex === null) {
        outstanding.push(
          `"${item.stem.slice(0, 50)}…" is marked by the App but has no correct answer.`,
        );
      }
    }
    const sectionMarks = section.items.reduce(
      (sum, item) => sum + (item.points ?? 0),
      0,
    );
    if (section.markTotal !== null && section.markTotal !== sectionMarks) {
      outstanding.push(
        `"${section.title}" is printed as ${section.markTotal} marks but its questions add up to ${sectionMarks}.`,
      );
    }
  }

  const known = new Set(criteria.map((criterion) => criterion.code));
  const unknownCodes = [
    ...new Set(
      allItems.flatMap((item) => item.criterionCodes).filter((c) => !known.has(c)),
    ),
  ];

  return (
    <div className="space-y-6">
      {edited ? (
        <p className="rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-3 py-2 text-sm">
          You have made corrections. What gets committed is what is on this
          screen now, not what was read out of the file.
        </p>
      ) : null}

      <Findings
        outstanding={outstanding}
        original={proposal.problems}
        notes={paper.notes}
      />

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">The paper</h2>
          <span className="text-sm text-[var(--muted)]">
            {allItems.length} questions · {marks} marks · {byApp.length} marked
            by the App
          </span>
        </div>

        {classified ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            From the filename:{" "}
            {[
              classified.provider,
              classified.qualification,
              classified.studyUnit,
              classified.artefact,
            ]
              .filter(Boolean)
              .join(" · ") || "nothing recognised"}
          </p>
        ) : null}

        <div className="mt-5 space-y-6">
          {paper.sections.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              <p className="text-sm font-medium">
                {section.title}
                <span className="ml-2 font-normal text-[var(--muted)]">
                  printed {section.markTotal ?? "?"} marks
                </span>
              </p>

              <ol className="mt-2 space-y-3">
                {section.items.map((item, itemIndex) => (
                  <li
                    key={itemIndex}
                    className="rounded-md border border-[var(--border)] p-3"
                  >
                    <textarea
                      value={item.stem}
                      onChange={(event) =>
                        updateItem(sectionIndex, itemIndex, {
                          stem: event.target.value,
                        })
                      }
                      rows={2}
                      className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                      aria-label={`Question ${itemIndex + 1} wording`}
                    />

                    {item.options.length > 0 ? (
                      <ul className="mt-2 space-y-1 pl-1 text-sm">
                        {item.options.map((option, optionIndex) => (
                          <li key={optionIndex} className="flex items-start gap-2">
                            <input
                              type="radio"
                              name={`correct-${sectionIndex}-${itemIndex}`}
                              checked={item.correctIndex === optionIndex}
                              onChange={() =>
                                updateItem(sectionIndex, itemIndex, {
                                  correctIndex: optionIndex,
                                })
                              }
                              className="mt-1"
                              aria-label={`Option ${String.fromCharCode(65 + optionIndex)} is correct`}
                            />
                            <span className="text-[var(--muted)]">
                              {String.fromCharCode(65 + optionIndex)}.
                            </span>
                            <span>{option}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-end gap-3 text-xs">
                      <label>
                        <span className="mb-0.5 block text-[var(--muted)]">
                          Marks
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={item.points ?? ""}
                          onChange={(event) =>
                            updateItem(sectionIndex, itemIndex, {
                              points:
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                          className="w-20 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                        />
                      </label>

                      <label>
                        <span className="mb-0.5 block text-[var(--muted)]">
                          Marked by
                        </span>
                        <select
                          value={item.markedBy}
                          onChange={(event) =>
                            updateItem(sectionIndex, itemIndex, {
                              markedBy: event.target.value as "app" | "assessor",
                              // Handing a question to an assessor drops the key:
                              // keeping it would leave a stale answer that
                              // nothing uses and everything reports on.
                              correctIndex:
                                event.target.value === "assessor"
                                  ? null
                                  : item.correctIndex,
                            })
                          }
                          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                        >
                          <option value="app">The App</option>
                          <option value="assessor">An assessor</option>
                        </select>
                      </label>

                      <label className="flex-1">
                        <span className="mb-0.5 block text-[var(--muted)]">
                          Criteria, comma separated
                        </span>
                        <input
                          value={item.criterionCodes.join(", ")}
                          onChange={(event) =>
                            updateItem(sectionIndex, itemIndex, {
                              criterionCodes: event.target.value
                                .split(",")
                                .map((code) => code.trim().toUpperCase())
                                .filter(Boolean),
                            })
                          }
                          placeholder="IAC0101, IAC0102"
                          className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono"
                        />
                      </label>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <form
        action={commit}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <h2 className="text-base font-semibold">Commit this as a paper</h2>

        {state.error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {state.error}
          </p>
        ) : null}

        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="confirmed" value={JSON.stringify(paper)} />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Which assessment</span>
            <select
              name="assessmentId"
              required
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="">Choose…</option>
              {assessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {assessment.title} ({assessment.purpose})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Paper code</span>
            <input
              name="paperCode"
              defaultValue="V1"
              required
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
        </div>

        {unknownCodes.length > 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            {unknownCodes.join(", ")}{" "}
            {unknownCodes.length === 1
              ? "is not a criterion"
              : "are not criteria"}{" "}
            on this qualification, so{" "}
            {unknownCodes.length === 1 ? "it" : "they"} will not be linked.
            Correct the codes above if that is a typo.
          </p>
        ) : null}

        {outstanding.length > 0 ? (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="acknowledgedProblems"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1"
            />
            <span>
              I have read the {outstanding.length} outstanding{" "}
              {outstanding.length === 1 ? "item" : "items"} above and want to
              commit anyway. This is recorded against my name.
            </span>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={committing || (outstanding.length > 0 && !acknowledged)}
          className="mt-4 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          {committing ? "Committing…" : "Confirm and commit"}
        </button>

        <p className="mt-2 text-xs text-[var(--muted)]">
          Confirming accepts responsibility for every correct answer in this
          paper. Your name stays on it.
        </p>
      </form>
    </div>
  );
}

function Findings({
  outstanding,
  original,
  notes,
}: {
  outstanding: string[];
  original: string[];
  notes: string[];
}) {
  // Faults the parser found that are about the material rather than the parse
  // — a repeated correct answer, a duplicated question — stay listed even once
  // the mechanical ones are fixed, because only the author can decide them.
  const material = original.filter(
    (problem) =>
      !/no correct answer|add up to/.test(problem) &&
      !outstanding.includes(problem),
  );

  return (
    <>
      {outstanding.length > 0 ? (
        <section className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-5">
          <h2 className="text-base font-semibold text-[var(--danger)]">
            {outstanding.length}{" "}
            {outstanding.length === 1 ? "thing needs" : "things need"} fixing
          </h2>
          <p className="mt-1 text-sm">
            Correct these below, or read them and say you want to go on anyway.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {outstanding.map((problem, index) => (
              <li key={index}>· {problem}</li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-lg border border-[var(--success)]/40 bg-[var(--success)]/5 p-5">
          <h2 className="text-base font-semibold text-[var(--success)]">
            Nothing outstanding
          </h2>
          <p className="mt-1 text-sm">
            Every question the App will mark has an answer, and every section
            adds up to what it prints.
          </p>
        </section>
      )}

      {material.length > 0 ? (
        <section className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-5">
          <h2 className="text-base font-semibold">About the material itself</h2>
          <p className="mt-1 text-sm">
            The document was read correctly. These are things about the paper
            that only its author can decide.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {material.map((problem, index) => (
              <li key={index}>· {problem}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {notes.length > 0 ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Worth knowing
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
