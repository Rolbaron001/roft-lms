"use client";

import { useActionState } from "react";
import { moderateJudgementAction, type RecognitionState } from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * A moderator agreeing or disagreeing with an RPL judgement.
 *
 * The comment is required either way, not only on a disagreement. A moderator
 * who agreed without saying why has recorded a signature rather than a
 * moderation, and the external verifier reading this later cannot tell the two
 * apart.
 */
export function ModerateJudgement({ judgementId }: { judgementId: string }) {
  const [state, action, saving] = useActionState<RecognitionState, FormData>(
    moderateJudgementAction,
    {},
  );

  return (
    <form action={action} className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
      <input type="hidden" name="judgementId" value={judgementId} />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="agreed" defaultChecked />
        I agree with this judgement
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[16rem] flex-1 text-sm">
          <span className="text-[var(--muted)]">
            What you checked, and what you concluded
          </span>
          <textarea
            name="comment"
            required
            rows={2}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>

        <label className="text-sm">
          <span className="text-[var(--muted)]">Granted on</span>
          <input
            type="date"
            name="grantedOn"
            required
            className={`${inputClass} mt-1 block`}
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Recording…" : "Record"}
        </button>
      </div>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}
    </form>
  );
}
