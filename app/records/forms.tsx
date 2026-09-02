"use client";

import { useActionState, useState } from "react";
import {
  fileDocumentAction,
  recordDisposalAction,
  type RecordsActionState,
} from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

export const CATEGORY_LABEL: Record<string, string> = {
  policy: "Policies and procedures",
  accreditation: "Accreditation",
  contract: "Contracts",
  statutory: "Statutory",
  operational: "Operational",
  other: "Other",
};

/**
 * Filing a business document.
 *
 * The supersedes field is the one worth the space. Naming what this replaces
 * marks the old one superseded in the same act, so there is never a moment
 * where two documents both claim to be current - which is what happens when
 * marking the old one is a second step somebody has to remember.
 */
export function FileDocument({
  current,
}: {
  current: { id: string; title: string; version: string | null }[];
}) {
  const [state, action, saving] = useActionState<RecordsActionState, FormData>(
    fileDocumentAction,
    {},
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass}
      >
        File a document
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select name="category" className={inputClass}>
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="title"
          required
          placeholder="Title"
          className={inputClass}
        />
        <input name="version" placeholder="Version" className={inputClass} />
        <input
          name="reference"
          placeholder="Your reference"
          className={inputClass}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">Effective from</span>
          <input type="date" name="effectiveFrom" className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">Expires</span>
          <input type="date" name="expiresOn" className={inputClass} />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mr-2 text-[var(--muted)]">Replaces</span>
        <select name="supersedesId" defaultValue="" className={inputClass}>
          <option value="">Nothing — this is new</option>
          {current.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title}
              {row.version ? ` (${row.version})` : ""}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[var(--muted)]">
          The one it replaces is kept and marked superseded. The policy that
          governed in March is what an audit of March asks about.
        </span>
      </label>

      <textarea
        name="description"
        rows={2}
        placeholder="What it is, if the title does not say"
        className={`${inputClass} block w-full`}
      />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="visibleToAll" />
        Anybody signed in may read this
      </label>

      <input type="file" name="file" required className="block text-sm" />

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Filing…" : "File it"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonClass}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Deciding what happens to a record past its retention date.
 *
 * Three outcomes, and two of them need a reason. Destroying is irreversible and
 * somebody will one day ask why a record a verifier wanted is not there.
 * Keeping something deliberately is a position rather than an oversight, and
 * the reason belongs in the file rather than in somebody's memory.
 */
export function DisposalForm({
  learnerId,
  name,
  dueOn,
}: {
  learnerId: string;
  name: string;
  dueOn: string;
}) {
  const [state, action, saving] = useActionState<RecordsActionState, FormData>(
    recordDisposalAction,
    {},
  );
  const [status, setStatus] = useState("archived");

  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="subject" value="learner_documents" />
      <input type="hidden" name="learnerId" value={learnerId} />
      <input type="hidden" name="dueOn" value={dueOn} />

      <div className="flex flex-wrap gap-2">
        <select
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className={inputClass}
        >
          <option value="archived">Archive — move it out of the way</option>
          <option value="retained">Keep it beyond retention</option>
          <option value="destroyed">Destroy it</option>
        </select>
        <button type="submit" disabled={saving} className={buttonClass}>
          {saving ? "Recording…" : "Record"}
        </button>
      </div>

      {status !== "archived" ? (
        <input
          name="reason"
          required
          placeholder={
            status === "destroyed"
              ? "Why this may be destroyed"
              : "Why this is being kept"
          }
          className={`${inputClass} block w-full`}
        />
      ) : null}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}

      <p className="sr-only">{name}</p>
    </form>
  );
}
