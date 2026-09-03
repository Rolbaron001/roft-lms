"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AiAssist } from "@/components/ai-assist";
import { readFolderAction, type ImportActionState } from "@/app/ai-import/actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Building a whole qualification from a folder, offered where qualifications
 * are created rather than on a page of its own.
 *
 * One field, because there is one thing it needs. The warning about how long
 * it takes is there because a model reading a curriculum document is not a page
 * load, and a form that looks as though it has hung gets clicked again - which
 * starts a second run against the same subscription for nothing.
 */
export function FromFolder({
  available,
  unavailableReason,
  roots,
}: {
  available: boolean;
  unavailableReason: string | null;
  roots: string[];
}) {
  const [state, action, reading] = useActionState<ImportActionState, FormData>(
    readFolderAction,
    {},
  );

  return (
    <AiAssist
      title="Build this from a folder"
      invitation="Point it at a qualification folder and it reads everything in it — the curriculum, the study units, the guides, the policies — and shows you what it would create."
      available={available}
      unavailableReason={unavailableReason}
    >
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
            <Link href="/ai-import" className="underline">
              Review it
            </Link>
          </p>
        ) : null}

        <button
          type="submit"
          disabled={reading || roots.length === 0}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {reading ? "Reading — this can take a few minutes…" : "Read the folder"}
        </button>

        <p className="max-w-2xl text-xs text-[var(--muted)]">
          Nothing is written yet. It produces a plan you read and then commit in
          one act, and a folder carrying its own blueprint file is read from
          that directly — no model, no guessing, and a few seconds rather than a
          few minutes.
        </p>
      </form>
    </AiAssist>
  );
}
