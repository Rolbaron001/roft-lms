"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { recordModerationAction, type DecisionState } from "../assess/actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Item = {
  decisionId: string;
  outcome: string;
  reason: string;
  assessorName: string;
  assessorId: string;
  assessmentTitle: string;
  courseTitle: string | null;
  submissionId: string;
};

function ModerationForm({ decisionId }: { decisionId: string }) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(
    recordModerationAction,
    {},
  );
  const [outcome, setOutcome] = useState("endorsed");

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="decisionId" value={decisionId} />

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Your review</span>
        <select
          name="outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          className={inputClass}
        >
          <option value="endorsed">
            Endorse — the decision is sound
          </option>
          <option value="referred_back">
            Refer back — the assessor should look again
          </option>
          <option value="overridden">
            Override — replace the decision
          </option>
        </select>
      </label>

      {outcome === "overridden" ? (
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            Replace the outcome with
          </span>
          <select
            name="revisedOutcome"
            defaultValue="not_yet_competent"
            className={inputClass}
          >
            <option value="competent">Competent</option>
            <option value="not_yet_competent">Not yet competent</option>
          </select>
        </label>
      ) : null}

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          Reasons{" "}
          <span className="font-normal text-[var(--muted)]">
            (kept with the record)
          </span>
        </span>
        <textarea name="comments" rows={3} className={inputClass} />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
          {state.notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? "Recording…" : "Record moderation"}
      </button>
    </form>
  );
}

export function ModerationList({
  items,
  currentUserId,
}: {
  items: Item[];
  currentUserId: string;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const ownDecision = item.assessorId === currentUserId;

        return (
          <section
            key={item.decisionId}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{item.assessmentTitle}</p>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  {item.courseTitle ? `${item.courseTitle} · ` : ""}
                  assessed{" "}
                  <span className="capitalize">
                    {item.outcome.replace(/_/g, " ")}
                  </span>{" "}
                  by {item.assessorName}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {item.reason}
                </p>
              </div>
              <Link
                href={`/assess/${item.submissionId}`}
                className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                See the evidence
              </Link>
            </div>

            {ownDecision ? (
              <p className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
                You made this decision as the assessor, so you cannot moderate
                it. Another moderator must.
              </p>
            ) : openFor === item.decisionId ? (
              <ModerationForm decisionId={item.decisionId} />
            ) : (
              <button
                type="button"
                onClick={() => setOpenFor(item.decisionId)}
                className="mt-3 text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                Moderate this decision
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
