"use client";

import { useActionState } from "react";
import { readFolderAction, type ImportActionState } from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Pointing the extension at a folder.
 *
 * One field, and a warning that it takes minutes. A model reading a
 * curriculum document is not a page load, and a form that looks as though it
 * has hung gets clicked again - which starts a second run against the same
 * subscription for no reason.
 */
export function FolderReader({ roots }: { roots: string[] }) {
  const [state, action, reading] = useActionState<ImportActionState, FormData>(
    readFolderAction,
    {},
  );

  return (
    <form action={action} className="space-y-3">
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
          No folders have been allowed for this tenant. Add one in Settings
          first — a server process given a free path can read anything it can
          reach.
        </p>
      )}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <button
        type="submit"
        disabled={reading || roots.length === 0}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {reading ? "Reading — this takes a few minutes…" : "Read the folder"}
      </button>
    </form>
  );
}
