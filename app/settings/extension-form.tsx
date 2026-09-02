"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/components/ui";
import { updateImportRootsAction, type ExtensionState } from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * The one part of the AI extension that is an administrator's decision.
 *
 * Whether somebody uses model assistance at all is theirs and lives on their
 * own account page. Which folders on the server may be read is not a
 * preference: it is a security boundary, because a server process given a free
 * path can read anything it can reach, including the platform's own
 * configuration.
 */
export function ExtensionForm({ roots }: { roots: string[] }) {
  const [state, action, saving] = useActionState<ExtensionState, FormData>(
    updateImportRootsAction,
    {},
  );

  return (
    <Card
      title="AI extension — folders that may be read"
      description="Everything else about the extension is set by each person on their own account page. This is the part that is not a preference."
    >
      <form action={action} className="space-y-3">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">
            One folder per line, on the machine running the platform
          </span>
          <textarea
            name="allowedImportRoots"
            rows={4}
            defaultValue={roots.join("\n")}
            placeholder="F:\Qualifications"
            className={`${inputClass} mt-1 block w-full max-w-2xl font-mono`}
          />
        </label>

        <p className="max-w-2xl text-xs text-[var(--muted)]">
          On the machine running the platform, not on yours, if those differ. An
          allow-list rather than a free path: a server process given any folder
          can read anything it can reach. With nothing listed, nobody can run a
          folder import — which is the safe state for a tenant that has not
          thought about it yet.
        </p>

        {state.error ? (
          <p className="text-sm text-[var(--danger)]">{state.error}</p>
        ) : null}
        {state.notice ? (
          <p className="text-sm text-[var(--muted)]">{state.notice}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <Link href="/account" className="text-sm underline">
            Your own extension settings
          </Link>
        </div>
      </form>
    </Card>
  );
}
