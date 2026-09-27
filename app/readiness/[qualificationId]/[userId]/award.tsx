"use client";

import { useActionState, useState } from "react";
import { recordAwardAction, removeAwardAction, type AwardState } from "./actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Award = {
  id: string;
  certificateNumber: string;
  awardedOn: string;
  awardedBy: string;
  note: string | null;
};

function Problem({ state }: { state: AwardState }) {
  return state.error ? (
    <p
      role="alert"
      className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
    >
      {state.error}
    </p>
  ) : null;
}

function Held({
  award,
  qualificationId,
  userId,
  canManage,
}: {
  award: Award;
  qualificationId: string;
  userId: string;
  canManage: boolean;
}) {
  const [removing, setRemoving] = useState(false);
  const [state, action, pending] = useActionState<AwardState, FormData>(removeAwardAction, {});

  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-medium">Certificate {award.certificateNumber}</span>, awarded by{" "}
        {award.awardedBy} on{" "}
        {new Date(`${award.awardedOn}T00:00:00`).toLocaleDateString("en-ZA", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
        .
      </p>
      {award.note ? <p className="text-[var(--muted)]">{award.note}</p> : null}
      {canManage && !removing ? (
        <button
          type="button"
          onClick={() => setRemoving(true)}
          className="text-xs font-medium text-[var(--brand-accent)] hover:underline"
        >
          Entered wrongly? Remove it
        </button>
      ) : null}
      {removing ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="awardId" value={award.id} />
          <input type="hidden" name="qualificationId" value={qualificationId} />
          <input type="hidden" name="userId" value={userId} />
          <input
            name="reason"
            required
            minLength={3}
            placeholder="Why it is being removed"
            aria-label="Why it is being removed"
            className={inputClass}
          />
          <Problem state={state} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] disabled:opacity-60"
            >
              {pending ? "Removing…" : "Remove"}
            </button>
            <button
              type="button"
              onClick={() => setRemoving(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              Keep it
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * The qualification certificate: shown once recorded, and recorded here by
 * staff who manage enrolments when it arrives from the awarding body.
 */
export function QualificationAward({
  qualificationId,
  userId,
  award,
  canManage,
}: {
  qualificationId: string;
  userId: string;
  award: Award | null;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState<AwardState, FormData>(recordAwardAction, {});

  if (award) {
    return <Held award={award} qualificationId={qualificationId} userId={userId} canManage={canManage} />;
  }
  if (!canManage) {
    return <p className="text-sm text-[var(--muted)]">Not received yet.</p>;
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="qualificationId" value={qualificationId} />
      <input type="hidden" name="userId" value={userId} />
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Certificate number</span>
        <input name="certificateNumber" required className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Date on the certificate</span>
        <input name="awardedOn" type="date" required className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Awarded by</span>
        <input name="awardedBy" defaultValue="QCTO" required className={inputClass} />
      </label>
      <label className="block space-y-1.5 sm:col-span-3">
        <span className="block text-sm font-medium">
          Note <span className="font-normal text-[var(--muted)]">(optional)</span>
        </span>
        <input name="note" className={inputClass} />
      </label>
      <div className="space-y-2 sm:col-span-3">
        <Problem state={state} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Recording…" : "Record the certificate"}
        </button>
      </div>
    </form>
  );
}
