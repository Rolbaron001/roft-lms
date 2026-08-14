"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { issueStatementAction, type IssueState } from "./actions";

function Button({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Issuing…" : label}
    </button>
  );
}

export function IssueStatement({
  qualificationId,
  userId,
  existing,
}: {
  qualificationId: string;
  userId: string;
  existing: { id: string; reference: string } | null;
}) {
  const [state, formAction] = useActionState<IssueState, FormData>(
    issueStatementAction,
    {},
  );

  if (existing && !state.statementId) {
    return (
      <p className="mt-3 text-sm">
        <a
          href={`/statements/${existing.id}`}
          className="underline underline-offset-2"
        >
          Statement of Results
        </a>{" "}
        <span className="font-mono text-xs text-[var(--muted)]">
          {existing.reference}
        </span>
      </p>
    );
  }

  if (state.statementId) {
    return (
      <p className="mt-3 text-sm" style={{ color: "var(--success)" }}>
        Issued.{" "}
        <a
          href={`/statements/${state.statementId}`}
          className="underline underline-offset-2"
        >
          Open the Statement of Results
        </a>
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-3">
      {/* Shown even when the learner is plainly not ready. Pressing it returns
          the list of what is outstanding, which is the question the person
          pressing it actually has. */}
      <input type="hidden" name="qualificationId" value={qualificationId} />
      <input type="hidden" name="userId" value={userId} />

      {state.reasons ? (
        <div
          role="alert"
          className="mb-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm"
        >
          <p style={{ color: "var(--danger)" }}>
            A Statement of Results cannot be issued yet.
          </p>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            {state.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <Button label="Issue Statement of Results" />
    </form>
  );
}
