"use client";

import { useActionState, useState } from "react";
import { reclassifyAction, type EditorState } from "./actions";

const field =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/**
 * Saying this qualification was filed as the wrong sort of thing.
 *
 * Until now the kind and the parent were settable only at import, so getting
 * it wrong meant deleting the qualification and importing it again, losing its
 * documents and anything already built on it. That is a heavy price for the
 * most ordinary mistake there is.
 *
 * What it holds is shown rather than hidden, because the consequences are not
 * obvious: a qualification imported as full has a curriculum of its own, and
 * as a part it draws from its parent's instead. Both facts stay true, and
 * somebody making this change should see the second one coming.
 */
export function ReclassifyForm({
  qualificationId,
  kind,
  parentId,
  ownModules,
  selectedModules,
  enrolled,
  candidates,
}: {
  qualificationId: string;
  kind: "full" | "part" | "skills_programme";
  parentId: string | null;
  ownModules: number;
  selectedModules: number;
  enrolled: number;
  /** Full qualifications this one could be a part of. */
  candidates: { id: string; title: string }[];
}) {
  const [state, act, working] = useActionState<EditorState, FormData>(
    reclassifyAction,
    {},
  );
  const [chosen, setChosen] = useState(kind);

  const needsParent = chosen !== "full";

  if (enrolled > 0) {
    // Not a disabled form. A control that cannot be used, with no reason
    // given, reads as a broken one — and the reason here is the whole point.
    return (
      <div className="space-y-2 text-sm">
        <p>
          This is recorded as{" "}
          <span className="font-medium">{LABELS[kind]}</span>.
        </p>
        <p className="text-[var(--muted)]">
          It cannot be changed: {enrolled}{" "}
          {enrolled === 1 ? "learner is" : "learners are"} enrolled on it.
          Enrolment is per programme ID, and changing what this is would change
          which modules they are assessed against — and so what they have to do
          to finish. If it is genuinely the wrong sort of thing, create the
          right one and enrol them onto that.
        </p>
      </div>
    );
  }

  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="qualificationId" value={qualificationId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">What this is</span>
          <select
            name="kind"
            value={chosen}
            onChange={(event) =>
              setChosen(event.target.value as typeof chosen)
            }
            className={`${field} w-full`}
          >
            <option value="full">A full qualification</option>
            <option value="part">A part qualification</option>
            <option value="skills_programme">A skills programme</option>
          </select>
        </label>

        {needsParent ? (
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Drawn from</span>
            <select
              name="parentId"
              defaultValue={parentId ?? ""}
              required
              className={`${field} w-full`}
            >
              <option value="">Choose the full qualification</option>
              {candidates.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.title}
                </option>
              ))}
            </select>
            <span className="block text-xs text-[var(--muted)]">
              A part has no curriculum document of its own — it uses its
              parent&rsquo;s, and selects modules from it.
            </span>
          </label>
        ) : null}
      </div>

      {/* What the change leaves behind, said before it is made. */}
      {needsParent && ownModules > 0 ? (
        <p className="max-w-2xl text-xs text-[var(--muted)]">
          This qualification has {ownModules}{" "}
          {ownModules === 1 ? "module" : "modules"} of its own curriculum, from
          when it was imported. Those stay where they are — recording it as a
          part does not delete them, and you choose separately which of the
          parent&rsquo;s modules it selects.
        </p>
      ) : null}

      {chosen === "full" && selectedModules > 0 ? (
        <p className="max-w-2xl text-xs text-[var(--muted)]">
          The {selectedModules}{" "}
          {selectedModules === 1 ? "module" : "modules"} selected from its
          parent will be cleared. A full qualification selects nothing from
          anybody, and leaving them would keep them counting towards its
          credits.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={working}
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
      >
        {working ? "Recording…" : "Record what this is"}
      </button>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
          {state.done}
        </p>
      ) : null}
    </form>
  );
}

const LABELS: Record<string, string> = {
  full: "a full qualification",
  part: "a part qualification",
  skills_programme: "a skills programme",
};
