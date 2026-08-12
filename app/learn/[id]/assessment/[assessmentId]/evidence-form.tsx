"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Submitted = { sha256: string; sizeBytes: number };

/**
 * Submitting evidence: a workplace logbook, a recording of a practical task,
 * a project artefact.
 *
 * The hash is shown back to the learner deliberately. It is the thing that
 * makes their portfolio defensible later, and seeing it appear makes the point
 * that what they submitted is now fixed — for their protection as much as
 * anyone's.
 */
export function EvidenceForm({
  assessmentId,
  enrolmentId,
}: {
  assessmentId: string;
  enrolmentId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted[] | null>(null);

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setProgress(0);

    const body = new FormData(event.currentTarget);
    body.append("enrolmentId", enrolmentId);

    const request = new XMLHttpRequest();
    request.open("POST", `/api/assessments/${assessmentId}/evidence`);

    request.upload.addEventListener("progress", (progressEvent) => {
      if (progressEvent.lengthComputable) {
        setProgress(
          Math.round((progressEvent.loaded / progressEvent.total) * 100),
        );
      }
    });

    request.addEventListener("load", () => {
      setProgress(null);
      let payload: { error?: string; files?: Submitted[] } = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = {};
      }

      if (request.status >= 200 && request.status < 300) {
        setSubmitted(payload.files ?? []);
        formRef.current?.reset();
        router.refresh();
      } else {
        setError(payload.error ?? "That could not be submitted.");
      }
    });

    request.addEventListener("error", () => {
      setProgress(null);
      setError("The upload failed. Check your connection and try again.");
    });

    request.send(body);
  }

  if (submitted) {
    return (
      <section className="rounded-lg border-2 border-[var(--success)]/40 bg-[var(--surface)] p-6">
        <h2 className="font-medium" style={{ color: "var(--success)" }}>
          Evidence submitted
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          An assessor will review it and record a competency decision. You will
          see the result once that is done.
        </p>

        {submitted.length > 0 ? (
          <>
            <p className="mt-4 text-sm font-medium">
              Each file has been fingerprinted:
            </p>
            <ul className="mt-2 space-y-1">
              {submitted.map((file) => (
                <li
                  key={file.sha256}
                  className="font-mono text-[11px] break-all text-[var(--muted)]"
                >
                  {file.sha256}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--muted)]">
              If any stored file were ever altered, its fingerprint would stop
              matching. That protects your work as much as it protects the
              assessment.
            </p>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={send}
      className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <div>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Your evidence</span>
          <input
            type="file"
            name="files"
            multiple
            required
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        </label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Photographs, a recording of the task, a scanned logbook, or a document.
          You can attach several at once.
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          Anything the assessor should know{" "}
          <span className="font-normal text-[var(--muted)]">(optional)</span>
        </span>
        <textarea
          name="note"
          rows={3}
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
        />
      </label>

      {progress !== null ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, background: "var(--brand-accent)" }}
            />
          </div>
          <p className="text-xs text-[var(--muted)]">Uploading… {progress}%</p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={progress !== null}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {progress !== null ? "Submitting…" : "Submit evidence"}
      </button>
    </form>
  );
}
