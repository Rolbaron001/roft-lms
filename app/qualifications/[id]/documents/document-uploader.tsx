"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { uploadDocumentAction, type UploadState } from "./actions";

const FIELD =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload document"}
    </button>
  );
}

export function DocumentUploader({
  qualificationId,
  kinds,
  units,
  modules,
}: {
  qualificationId: string;
  kinds: { value: string; label: string }[];
  units: { id: string; code: string; title: string }[];
  modules: { id: string; code: string; title: string }[];
}) {
  const [state, formAction] = useActionState<UploadState, FormData>(
    uploadDocumentAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="qualificationId" value={qualificationId} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {state.message ? (
        <div className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm">
          <p style={{ color: "var(--success)" }}>{state.message}</p>
          {state.detail ? (
            <ul className="mt-2 space-y-1 text-[var(--muted)]">
              {state.detail.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="kind" className="block text-sm font-medium">
            What kind of document
          </label>
          <select id="kind" name="kind" required className={FIELD}>
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted)]">
            A curriculum alignment matrix is read as well as stored — what it
            says about each curriculum line is recorded.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="attachTo" className="block text-sm font-medium">
            Attach it to
          </label>
          <select id="attachTo" name="attachTo" className={FIELD}>
            <option value="qualification">The whole qualification</option>
            {units.map((unit) => (
              <option key={unit.id} value={`unit:${unit.id}`}>
                {unit.code} — {unit.title}
              </option>
            ))}
            {modules.map((entry) => (
              <option key={entry.id} value={`module:${entry.id}`}>
                {entry.code} — {entry.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder="Left blank, the file name is used"
            className={FIELD}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="version" className="block text-sm font-medium">
            Version
          </label>
          <input
            id="version"
            name="version"
            type="text"
            placeholder="V2, Final, 07072025"
            className={FIELD}
          />
          <p className="text-xs text-[var(--muted)]">
            Uploading again with the same kind and title supersedes the
            previous one rather than replacing it — the old version stays.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="file" className="block text-sm font-medium">
          File
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          accept=".docx,.xlsx,.pdf,.pptx,.doc,.xls,.ppt"
          className={FIELD}
        />
        <p className="text-xs text-[var(--muted)]">
          Word, Excel, PowerPoint and PDF. What the file actually is comes from
          its contents, not its name.
        </p>
      </div>

      <SubmitButton />
    </form>
  );
}
