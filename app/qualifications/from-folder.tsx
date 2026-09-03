"use client";

import Link from "next/link";
import { useActionState } from "react";
import { readFolderAction, type ImportActionState } from "@/app/imports/actions";
import { Card } from "@/components/ui";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Building a whole qualification from a folder.
 *
 * Ordinary functionality, available to anybody who can manage a qualification.
 * A folder carrying its own blueprint is read from that file: no model, no
 * extension, no waiting, and it works on the server exactly as on a desktop.
 *
 * The extension adds one thing, and the form says which: reading the structure
 * out of the documents, for a folder that has no blueprint. Somebody without an
 * extension should see what they would gain rather than find the whole feature
 * missing, which is what the first version did.
 */
export function FromFolder({
  roots,
  extension,
}: {
  roots: string[];
  /** Null where this person's role has no model assistance at all. */
  extension: {
    enabled: boolean;
    available: boolean;
    reason: string | null;
  } | null;
}) {
  const [state, action, reading] = useActionState<ImportActionState, FormData>(
    readFolderAction,
    {},
  );

  const ready = Boolean(extension?.enabled && extension.available);

  return (
    <Card
      title="Build it from a folder"
      description="Point at a qualification folder and it reads everything in it — the curriculum, the study units, the guides, the policies — and shows you what it would create. Nothing is written until you say so."
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
            <Link href="/imports" className="underline">
              Review it
            </Link>
          </p>
        ) : null}

        <button
          type="submit"
          disabled={reading || roots.length === 0}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {reading ? "Reading…" : "Read the folder"}
        </button>

        {/*
          What the extension changes, said in one place. Somebody without one
          should understand exactly what they would gain; somebody with one
          should understand that most of this never touches it.
        */}
        <div className="max-w-2xl border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          <p>
            A folder carrying its own{" "}
            <span className="font-mono">_control/blueprint.json</span> is read
            straight from that file — in seconds, with no AI involved, and the
            structure is exactly what the file says.
          </p>

          <p className="mt-2">
            {ready ? (
              <>
                <span className="font-medium text-[var(--success)]">
                  Your AI extension is on.
                </span>{" "}
                A folder with no blueprint will have its structure read out of
                the documents instead — slower, and worth checking against the
                curriculum document.
              </>
            ) : extension?.enabled ? (
              <>
                <span className="font-medium">
                  Your AI extension cannot run here.
                </span>{" "}
                {extension.reason} A folder with a blueprint still imports
                normally; one without cannot have its structure read.
              </>
            ) : (
              <>
                <span className="font-medium">
                  An AI extension adds one thing here:
                </span>{" "}
                reading the structure out of the documents when a folder has no
                blueprint. Everything else works without one. You can switch one
                on under{" "}
                <Link href="/account" className="underline">
                  your account
                </Link>
                .
              </>
            )}
          </p>
        </div>
      </form>
    </Card>
  );
}
