"use client";

import { useActionState, useState } from "react";
import { recordOralAction, type ReviewState } from "../actions";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export type Exchange = {
  criterionId?: string;
  question: string;
  response: string;
  note?: string;
};

export type CriterionOption = {
  id: string;
  code: string;
  description: string;
};

/**
 * What was asked and what was answered.
 *
 * A written attempt leaves its own evidence — the paper, the answers, the
 * marks. An oral attempt leaves nothing at all unless the assessor writes it
 * down, so this is the evidence behind the decision rather than a formality
 * beside it. Recording the outcome is refused until at least one exchange is
 * here, in the library as well as on this screen.
 *
 * Rows are added as the conversation goes rather than fixed in advance,
 * because an oral assessment follows the answers.
 */
export function OralRecord({
  submissionId,
  criteria,
  existing,
  medium,
  witnessName,
}: {
  submissionId: string;
  criteria: CriterionOption[];
  existing: Exchange[];
  medium: string | null;
  witnessName: string | null;
}) {
  const [state, act, pending] = useActionState<ReviewState, FormData>(
    recordOralAction,
    {},
  );

  const [rows, setRows] = useState<Exchange[]>(
    existing.length > 0
      ? existing
      : [{ question: "", response: "", criterionId: "" }],
  );

  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">How it was conducted</span>
          <input
            name="medium"
            defaultValue={medium ?? ""}
            placeholder="In person, or the video call it was held on"
            className={field}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            Who else was present{" "}
            <span className="font-normal text-[var(--muted)]">(optional)</span>
          </span>
          <input
            name="witnessName"
            defaultValue={witnessName ?? ""}
            placeholder="Name and role"
            className={field}
          />
          <span className="block text-xs text-[var(--muted)]">
            Not required. An oral assessment with nobody else in the room is
            harder to defend at moderation, and the record should say which
            kind this was.
          </span>
        </label>
      </div>

      <div className="space-y-4">
        {rows.map((row, index) => (
          <div
            key={index}
            className="rounded-md border border-[var(--border)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Question {index + 1}
              </span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setRows(rows.filter((_, position) => position !== index))
                  }
                  className="text-xs text-[var(--danger)] hover:underline"
                >
                  Remove
                </button>
              ) : null}
            </div>

            <label className="mt-2 block space-y-1.5">
              <span className="block text-sm font-medium">What was asked</span>
              <textarea
                name="question"
                rows={2}
                defaultValue={row.question}
                className={field}
              />
            </label>

            <label className="mt-2 block space-y-1.5">
              <span className="block text-sm font-medium">
                What they answered
              </span>
              <textarea
                name="response"
                rows={3}
                defaultValue={row.response}
                className={field}
              />
            </label>

            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  Against which criterion
                </span>
                <select
                  name="criterionId"
                  defaultValue={row.criterionId ?? ""}
                  className={field}
                >
                  <option value="">Not tied to one</option>
                  {criteria.map((criterion) => (
                    <option key={criterion.id} value={criterion.id}>
                      {criterion.code} — {criterion.description.slice(0, 70)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  Your note{" "}
                  <span className="font-normal text-[var(--muted)]">
                    (optional)
                  </span>
                </span>
                <input name="note" defaultValue={row.note ?? ""} className={field} />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          setRows([...rows, { question: "", response: "", criterionId: "" }])
        }
        className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
      >
        + Another question
      </button>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Saving…" : "Save the record"}
        </button>

        {state.error ? (
          <p
            role="alert"
            className="mt-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {state.error}
          </p>
        ) : null}
        {state.done ? (
          <p className="mt-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
            {state.done} The outcome is recorded on the marking screen, the same
            as any other attempt.
          </p>
        ) : null}
      </div>
    </form>
  );
}
