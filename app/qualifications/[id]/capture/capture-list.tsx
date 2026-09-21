"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  captureFiledAction,
  type CaptureFiledState,
} from "./actions";

/**
 * The papers this qualification holds, and the one button that captures them.
 *
 * Roland, 21 September: "This process needs a link to the qualification
 * upload... I don't see why this is a separate process. The workbooks and
 * assessments are in the folder, they have been read and linked. Why can't
 * they just be captured?"
 *
 * They can now. The second upload is gone; the review is not, because a parser
 * that reads question three's correct answer wrongly produces confidently
 * wrong marking and nobody finds out until a moderator does.
 *
 * A paper with no answer guide beside it is marked as such rather than
 * quietly captured. It would produce a paper with no correct answers and no
 * marks, which looks like success on every screen.
 */
export type CapturableRow = {
  documentId: string;
  filename: string;
  kind: string;
  studyUnitCode: string | null;
  guide: { filename: string } | null;
  captured: boolean;
};

function CaptureButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      style={{ background: "var(--brand-primary)" }}
    >
      {pending ? "Reading…" : label}
    </button>
  );
}

export function CaptureList({
  qualificationId,
  rows,
}: {
  qualificationId: string;
  rows: CapturableRow[];
}) {
  const [state, act] = useActionState<CaptureFiledState, FormData>(
    captureFiledAction,
    {},
  );

  const outstanding = rows.filter((row) => !row.captured);

  return (
    <div>
      {state.error ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <p className="mb-3 text-sm text-[var(--muted)]">
        These are already in the platform. Capturing one reads its questions
        out of the Word file and pairs the answer guide filed beside it &mdash;
        nothing is uploaded again. What it proposes is shown to you before any
        of it becomes an assessment.
      </p>

      {outstanding.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--success)" }}>
          All {rows.length} captured. Learners can answer these on screen.
        </p>
      ) : null}

      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.documentId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {row.studyUnitCode ? (
                  <span className="mr-2 text-xs text-[var(--muted)]">
                    {row.studyUnitCode}
                  </span>
                ) : null}
                {row.filename}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {row.kind === "workbook" ? "Workbook" : "Summative assessment"}
                {" · "}
                {row.guide ? (
                  <>answer guide: {row.guide.filename}</>
                ) : (
                  /*
                    Said plainly rather than left to be discovered after the
                    capture. Without a guide there are no correct answers and
                    no marks, and every question has to be completed by hand.
                  */
                  <span style={{ color: "var(--danger)" }}>
                    no answer guide filed &mdash; every question would need its
                    answer and marks by hand
                  </span>
                )}
              </p>
            </div>

            {row.captured ? (
              <span
                className="text-xs font-medium"
                style={{ color: "var(--success)" }}
              >
                &#10003; captured
              </span>
            ) : (
              <form action={act}>
                <input
                  type="hidden"
                  name="qualificationId"
                  value={qualificationId}
                />
                <input type="hidden" name="documentId" value={row.documentId} />
                <CaptureButton label="Capture this &rarr;" />
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
