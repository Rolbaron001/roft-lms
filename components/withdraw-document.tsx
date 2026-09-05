"use client";

import { useActionState, useState } from "react";

type WithdrawState = { error?: string; notice?: string };

/**
 * Withdrawing an issued document.
 *
 * Behind a confirmation step rather than one click, because this is not
 * reversible from the interface and somebody may be looking at a learner's
 * certificate for an unrelated reason. The confirmation is the reason box
 * itself: you cannot withdraw without saying why, so the deliberate act and the
 * record of it are the same act.
 *
 * Hidden when printing. It is a control on a page that doubles as a document,
 * and it must not appear on the paper.
 */
export function WithdrawDocument({
  action,
  idName,
  idValue,
  what,
  consequence,
}: {
  action: (
    previous: WithdrawState,
    formData: FormData,
  ) => Promise<WithdrawState>;
  /** The form field the action reads the identifier from. */
  idName: string;
  idValue: string;
  /** "this certificate", "this Statement of Results". */
  what: string;
  /** Who is affected, said plainly before somebody commits. */
  consequence: string;
}) {
  const [state, submit, saving] = useActionState<WithdrawState, FormData>(
    action,
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.notice) {
    return (
      <p className="text-sm text-[var(--muted)] print:hidden">{state.notice}</p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] print:hidden"
      >
        Withdraw {what}
      </button>
    );
  }

  return (
    <form action={submit} className="max-w-xl space-y-2 print:hidden">
      <input type="hidden" name={idName} value={idValue} />

      <p className="text-sm">
        <span className="font-medium">Withdraw {what}?</span>{" "}
        <span className="text-[var(--muted)]">{consequence}</span>
      </p>

      <label className="block text-sm">
        <span className="text-[var(--muted)]">
          Why it is being withdrawn &mdash; this is the record
        </span>
        <textarea
          name="reason"
          required
          minLength={10}
          rows={2}
          className="mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
        />
      </label>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-[var(--danger)] px-3 py-1.5 text-sm text-[var(--danger)] disabled:opacity-60"
        >
          {saving ? "Withdrawing…" : "Withdraw it"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Keep it
        </button>
      </div>
    </form>
  );
}
