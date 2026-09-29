"use client";

import { useActionState } from "react";
import { importStatementsAction, type ImportState } from "./actions";
import { useT } from "@/components/i18n";

/** Bringing in learning recorded by another system. */
export function ImportForm() {
  const t = useT();
  const [state, act, pending] = useActionState<ImportState, FormData>(importStatementsAction, {});

  return (
    <form action={act} className="space-y-3">
      <input
        name="file"
        type="file"
        required
        accept=".json,application/json"
        className="block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? t("lrs.importing") : t("lrs.import")}
      </button>

      {state.error ? (
        <p role="alert" className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      {state.summary ? (
        <div className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm">
          <p style={{ color: "var(--success)" }}>
            {state.summary.alreadyHeld > 0
              ? t("lrs.addedHeld", {
                  added: state.summary.added,
                  read: state.summary.read,
                  held: state.summary.alreadyHeld,
                })
              : t("lrs.added", { added: state.summary.added, read: state.summary.read })}
          </p>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            <li>
              {state.summary.learnersMatched === 1
                ? t("lrs.matchedOne")
                : t("lrs.matched", { count: state.summary.learnersMatched })}
            </li>
            {state.summary.unmatchedActors.length > 0 ? (
              <li>
                {t("lrs.unmatched", {
                  names:
                    state.summary.unmatchedActors.slice(0, 10).join(", ") +
                    (state.summary.unmatchedActors.length > 10 ? "…" : ""),
                })}
              </li>
            ) : null}
            {state.summary.rejected.length > 0 ? (
              <li>
                {t("lrs.notRead", { reasons: state.summary.rejected.slice(0, 5).join(" ") })}
                {state.summary.rejected.length > 5
                  ? ` ${t("lrs.andMore", { count: state.summary.rejected.length - 5 })}`
                  : ""}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
