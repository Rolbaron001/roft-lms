"use client";

import { useActionState, useState } from "react";
import { uploadCaptureAction, type CaptureState } from "./actions";
import type { ProgrammeReadiness } from "@/lib/programme-readiness";

/**
 * Choosing a qualification, then uploading material for it.
 *
 * The qualification comes first deliberately. A programme is assembled in an
 * order: the three published documents, then the curriculum read in, then the
 * study units built on top. Material captured before the curriculum exists
 * cannot have its criteria linked, and putting that right afterwards means
 * re-tagging every question by hand.
 *
 * So this checks before it lets anybody upload, and says what is missing.
 */
export function UploadForm({
  programmes,
}: {
  programmes: ProgrammeReadiness[];
}) {
  const [state, upload, pending] = useActionState<CaptureState, FormData>(
    uploadCaptureAction,
    {},
  );
  const [chosen, setChosen] = useState("");

  const programme = programmes.find((row) => row.qualificationId === chosen);

  return (
    <form
      action={upload}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      {state.error ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          <p>{state.error}</p>
          {state.gaps && state.gaps.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {state.gaps.map((gap, index) => (
                <li key={index}>· {gap}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">
          Which qualification is this material for?
        </span>
        <select
          name="qualificationId"
          required
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          <option value="">Choose…</option>
          {programmes.map((row) => (
            <option key={row.qualificationId} value={row.qualificationId}>
              {row.title}
              {row.ready ? "" : " — not ready"}
            </option>
          ))}
        </select>
      </label>

      {programme ? <ReadinessPanel programme={programme} /> : null}

      {programme?.ready ? (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">
                The learner&rsquo;s copy
              </span>
              <input
                type="file"
                name="paper"
                accept=".docx"
                required
                className="w-full text-sm"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block font-medium">
                The answer guide{" "}
                <span className="font-normal text-[var(--muted)]">
                  (optional)
                </span>
              </span>
              <input
                type="file"
                name="guide"
                accept=".docx"
                className="w-full text-sm"
              />
              <span className="mt-1 block text-xs text-[var(--muted)]">
                Without it, no correct answers, marks or criteria can be read.
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="mt-4 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand-primary)" }}
          >
            {pending ? "Reading…" : "Read these documents"}
          </button>
        </>
      ) : null}
    </form>
  );
}

function ReadinessPanel({ programme }: { programme: ProgrammeReadiness }) {
  if (programme.ready) {
    return (
      <p className="mt-3 rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 px-3 py-2 text-sm">
        Ready. {programme.curriculum.modules} modules and{" "}
        {programme.curriculum.criteria} assessment criteria are in, so questions
        can be linked to what they evidence.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-4 text-sm">
      <p className="font-semibold text-[var(--danger)]">
        This qualification is not ready for material yet.
      </p>
      <p className="mt-1">
        Do these first, in this order. Until they are done a question cannot be
        tagged to what it evidences, and putting that right later means
        re-tagging every one of them by hand.
      </p>
      <ol className="mt-3 space-y-2">
        {programme.gaps.map((gap, index) => (
          <li key={index}>
            <span className="font-medium">
              {index + 1}. {gap.action}
            </span>
            <span className="block text-xs text-[var(--muted)]">{gap.why}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Documents are uploaded on the qualification&rsquo;s own page.
      </p>
    </div>
  );
}
