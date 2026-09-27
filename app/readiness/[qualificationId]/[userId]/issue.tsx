"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { issueStatementAction, type IssueState } from "./actions";
import { useT } from "@/components/i18n";

function Button({ label }: { label: string }) {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? t("issue.issuing") : label}
    </button>
  );
}

export function IssueStatement({
  qualificationId,
  userId,
  existing,
  studyUnit,
}: {
  qualificationId: string;
  userId: string;
  existing: { id: string; reference: string } | null;
  /** One study unit; absent for the whole-qualification statement. */
  studyUnit?: { id: string; code: string };
}) {
  const t = useT();
  const label = studyUnit ? t("issue.unit", { unit: studyUnit.code }) : t("issue.whole");
  const [state, formAction] = useActionState<IssueState, FormData>(
    issueStatementAction,
    {},
  );

  if (existing && !state.statementId) {
    return (
      <p className="mt-3 text-sm">
        <a href={`/statements/${existing.id}`} className="underline underline-offset-2">
          {studyUnit ? t("issue.statementFor", { unit: studyUnit.code }) : t("issue.statement")}
        </a>{" "}
        <span className="font-mono text-xs text-[var(--muted)]">{existing.reference}</span>
      </p>
    );
  }

  if (state.statementId) {
    return (
      <p className="mt-3 text-sm" style={{ color: "var(--success)" }}>
        {t("issue.issued")}{" "}
        <a href={`/statements/${state.statementId}`} className="underline underline-offset-2">
          {t("issue.open")}
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
      {studyUnit ? <input type="hidden" name="studyUnitId" value={studyUnit.id} /> : null}

      {state.reasons ? (
        <div
          role="alert"
          className="mb-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm"
        >
          <p style={{ color: "var(--danger)" }}>{t("issue.notYet")}</p>
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

      <Button label={label} />
    </form>
  );
}
