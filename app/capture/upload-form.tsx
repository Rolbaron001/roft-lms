"use client";

import { useActionState } from "react";
import { uploadCaptureAction, type CaptureState } from "./actions";

export function UploadForm() {
  const [state, upload, pending] = useActionState<CaptureState, FormData>(
    uploadCaptureAction,
    {},
  );

  return (
    <form
      action={upload}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      {state.error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
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
            <span className="font-normal text-[var(--muted)]">(optional)</span>
          </span>
          <input type="file" name="guide" accept=".docx" className="w-full text-sm" />
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
    </form>
  );
}
