"use client";

import Link from "next/link";
import { useActionState } from "react";
import { readFolderAction, type ImportActionState } from "@/app/imports/actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Filing a folder of material against a qualification that already exists.
 *
 * Entirely ordinary functionality, with no AI involved at any point and none
 * offered. Deciding that a file called "SU1 Theory Guide" is a theory guide for
 * study unit 1 is a rule and a filename, and where the folder carries a
 * manifest it is not even that - it is a lookup.
 *
 * The form says so, because somebody who has read about the AI extension
 * elsewhere would otherwise reasonably wonder whether this needs one.
 */
export function MaterialFolder({
  qualificationId,
  roots,
}: {
  qualificationId: string;
  roots: string[];
}) {
  const [state, action, reading] = useActionState<ImportActionState, FormData>(
    readFolderAction,
    {},
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="qualificationId" value={qualificationId} />

      <label className="block text-sm">
        <span className="text-[var(--muted)]">
          The folder, on the machine running the platform
        </span>
        <input
          name="path"
          required
          defaultValue={state.path ?? roots[0] ?? ""}
          placeholder={roots[0] ?? "No folders have been allowed yet"}
          className={`${inputClass} mt-1 block w-full max-w-2xl font-mono`}
        />
      </label>

      {roots.length > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          Allowed: {roots.join(", ")}
        </p>
      ) : (
        <p className="text-xs text-[var(--danger)]">
          No folders have been allowed for this tenant. An administrator lists
          them in Settings first.
        </p>
      )}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">
          {state.notice}{" "}
          {state.jobId ? (
            <Link href={`/imports/${state.jobId}`} className="underline">
              Review it
            </Link>
          ) : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={reading || roots.length === 0}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {reading ? "Reading…" : "Read the folder"}
      </button>

      <p className="max-w-2xl text-xs text-[var(--muted)]">
        Theory guides and workbooks go to the study unit their filename names;
        policies and contracts go to the document library; everything else is
        filed against this qualification. Nothing is written until you have seen
        what it found — and no AI extension is used here at all, because sorting
        documents by name is a rule rather than a judgement.
      </p>
    </form>
  );
}
