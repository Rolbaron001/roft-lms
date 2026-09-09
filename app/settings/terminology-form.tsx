"use client";

import { useActionState } from "react";
import {
  saveTerminologyAction,
  type TerminologyState,
} from "./terminology-actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type TermRow = {
  key: string;
  defaultOne: string;
  defaultMany: string;
  note: string;
  definedBy: "platform" | "practice";
  currentOne: string;
  currentMany: string;
};

const WHY: Record<string, string> = {
  platform: "the platform's word",
  practice: "used across the sector, owned by nobody",
};

/**
 * What this provider calls things.
 *
 * The defaults sit in the placeholder rather than the value, so an empty field
 * means "use the standard word" and the screen shows at a glance which words
 * have been changed and which have not. Filling every box with the value it
 * already has would freeze this provider on today's wording if a default ever
 * improved.
 *
 * Each row says who defines the term, because "we chose this word" and "the
 * sector uses it and nobody owns it" are different invitations to change it.
 * The words a regulator defines are not on this screen at all - see the note
 * at the foot, which explains their absence rather than leaving somebody to
 * wonder why they cannot find "qualification".
 */
export function TerminologyForm({ terms }: { terms: TermRow[] }) {
  const [state, action, saving] = useActionState<TerminologyState, FormData>(
    saveTerminologyAction,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="pb-2 pr-3 font-medium">Standard word</th>
              <th className="pb-2 pr-3 font-medium">You call one</th>
              <th className="pb-2 font-medium">You call several</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((term) => (
              <tr key={term.key} className="border-t border-[var(--border)]">
                <td className="py-2 pr-3 align-top">
                  <span className="font-medium">{term.defaultOne}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {term.note}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {WHY[term.definedBy]}
                  </span>
                </td>
                <td className="py-2 pr-3 align-top">
                  <input
                    name={`${term.key}.one`}
                    defaultValue={term.currentOne}
                    placeholder={term.defaultOne}
                    maxLength={40}
                    className={`${inputClass} w-full`}
                    aria-label={`What you call one ${term.defaultOne.toLowerCase()}`}
                  />
                </td>
                <td className="py-2 align-top">
                  <input
                    name={`${term.key}.many`}
                    defaultValue={term.currentMany}
                    placeholder={term.defaultMany}
                    maxLength={40}
                    className={`${inputClass} w-full`}
                    aria-label={`What you call several ${term.defaultMany.toLowerCase()}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <p className="max-w-2xl text-xs text-[var(--muted)]">
        <span className="font-medium text-[var(--foreground)]">
          Some words are not on this list, and that is deliberate.
        </span>{" "}
        Qualification, curriculum module, exit level outcome, NQF level and the
        rest are defined by the QCTO or SAQA rather than by you. Renaming one
        would put wording on a learner&rsquo;s screen and on a submission that
        the regulator does not recognise, so the platform keeps them fixed. You
        can read who defines what in the{" "}
        <a href="/dictionary" className="underline">
          dictionary
        </a>
        .
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save this wording"}
        </button>
        <button
          type="submit"
          name="intent"
          value="reset"
          disabled={saving}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] disabled:opacity-60"
        >
          Back to the standard wording
        </button>
      </div>
    </form>
  );
}
