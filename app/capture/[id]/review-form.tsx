"use client";

import { useActionState, useState } from "react";
import { commitCaptureAction, type CaptureState } from "../actions";
import type { ParsedPaper } from "@/lib/capture-parse";
import type { Classified } from "@/lib/capture";

/**
 * Confirming what was read out of a Word document.
 *
 * The findings come first and the commit button is below them, because the
 * order on the page is the order the reviewer should work in. Where anything
 * is still outstanding, going on requires saying so explicitly — the platform
 * puts what it found in front of a person and waits, rather than deciding for
 * them or letting the list scroll past unread.
 *
 * Confirming here is accepting responsibility for every correct answer in the
 * assessment, which is why it needs `assessment:author` and why the name is
 * recorded.
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
  const [acknowledged, setAcknowledged] = useState(false);

  const byApp = proposal.sections
    .flatMap((section) => section.items)
    .filter((item) => item.markedBy === "app");
  const byAssessor = proposal.sections
    .flatMap((section) => section.items)
    .filter((item) => item.markedBy === "assessor");
  const marks = proposal.sections.reduce(
    (sum, section) =>
      sum + section.items.reduce((s, item) => s + (item.points ?? 0), 0),
    0,
  );

  const known = new Set(criteria.map((criterion) => criterion.code));
  const unknownCodes = [
    ...new Set(
      proposal.sections
        .flatMap((section) => section.items)
        .flatMap((item) => item.criterionCodes)
        .filter((code) => !known.has(code)),
    ),
  ];

  return (
    <div className="space-y-6">
      {proposal.problems.length > 0 ? (
        <section className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-5">
          <h2 className="text-base font-semibold text-[var(--danger)]">
            {proposal.problems.length}{" "}
            {proposal.problems.length === 1 ? "thing needs" : "things need"} your
            attention
          </h2>
          <p className="mt-1 text-sm">
            Fix these in the Word document and upload it again, or read them and
            say you want to go on anyway. Nothing here is corrected for you:
            only you know which of two disagreeing numbers is the right one.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {proposal.problems.map((problem, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>{problem}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-lg border border-[var(--success)]/40 bg-[var(--success)]/5 p-5">
          <h2 className="text-base font-semibold text-[var(--success)]">
            Nothing outstanding
          </h2>
          <p className="mt-1 text-sm">
            Everything reconciled: every question the App will mark has an
            answer, and every section adds up to what it prints.
          </p>
        </section>
      )}

      {proposal.notes.length > 0 ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Worth knowing
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
            {proposal.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-base font-semibold">What was read</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="From the filename">
            {classified
              ? [
                  classified.provider,
                  classified.qualification,
                  classified.studyUnit,
                  classified.artefact,
                ]
                  .filter(Boolean)
                  .join(" · ") || "nothing recognised"
              : "no convention set"}
          </Row>
          <Row label="Questions">
            {byApp.length + byAssessor.length} · {marks} marks
          </Row>
          <Row label="Marked by the App">{byApp.length}</Row>
          <Row label="Marked by an assessor">{byAssessor.length}</Row>
        </dl>

        {classified && classified.unread.length > 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            The filename did not say the {classified.unread.join(", ")}. Choose
            below instead.
          </p>
        ) : null}

        <div className="mt-5 space-y-4">
          {proposal.sections.map((section, index) => (
            <div key={index}>
              <p className="text-sm font-medium">
                {section.title}
                <span className="ml-2 font-normal text-[var(--muted)]">
                  {section.markTotal ?? "?"} marks · {section.items.length}{" "}
                  questions
                </span>
              </p>
              <ol className="mt-1.5 space-y-1 text-sm">
                {section.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex flex-wrap gap-x-2">
                    <span className="tabular-nums text-[var(--muted)]">
                      {itemIndex + 1}.
                    </span>
                    <span className="min-w-0 flex-1">
                      {item.stem.slice(0, 120)}
                      {item.stem.length > 120 ? "…" : ""}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {item.points ?? "?"}m ·{" "}
                      {item.markedBy === "app"
                        ? item.correctIndex !== null
                          ? `answer ${String.fromCharCode(65 + item.correctIndex)}`
                          : "no answer"
                        : "assessor"}
                      {item.criterionCodes.length > 0
                        ? ` · ${item.criterionCodes.join(", ")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <form action={commit} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
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
            {unknownCodes.length === 1 ? "is not a criterion" : "are not criteria"}{" "}
            on any qualification here, so {unknownCodes.length === 1 ? "it" : "they"}{" "}
            will not be linked. Import the curriculum first if that is wrong.
          </p>
        ) : null}

        {proposal.problems.length > 0 ? (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="acknowledgedProblems"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-1"
            />
            <span>
              I have read the {proposal.problems.length} outstanding{" "}
              {proposal.problems.length === 1 ? "item" : "items"} above and want
              to commit anyway. This is recorded against my name.
            </span>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={
            committing || (proposal.problems.length > 0 && !acknowledged)
          }
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
