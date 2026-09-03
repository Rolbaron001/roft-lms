"use client";

import { useState, useTransition } from "react";
import { setAiAction } from "@/app/ai/actions";

/**
 * The switch itself.
 *
 * Deliberately plain and deliberately everywhere. Somebody switches it on for
 * one job and off again afterwards, so it has to be reachable without going to
 * a settings page and back - it sits in the header on every page, and again
 * beside the places that can actually use it.
 *
 * It says which state it is in rather than only offering the opposite action,
 * because this switch governs whether a credential is live. A control that
 * reads "Switch on" is ambiguous about whether it is currently off, and the
 * ambiguity matters more here than the extra word costs.
 */
export function AiSwitch({
  on,
  /** Compact enough for the header; the fuller form sits beside a task. */
  variant = "inline",
}: {
  on: boolean;
  variant?: "inline" | "header";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    setError(null);
    start(async () => {
      const result = await setAiAction(!on);
      if (result.error) setError(result.error);
    });
  }

  const label = on ? "AI on" : "AI off";

  return (
    <div className={variant === "header" ? "flex items-center" : "space-y-1"}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        title={
          on
            ? "Your AI extension is on for this sitting. It switches off when you sign out."
            : "Switch your AI extension on for this sitting."
        }
        className={[
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60",
          on
            ? "border-[var(--success)] text-[var(--success)]"
            : "border-[var(--border)] text-[var(--muted)]",
        ].join(" ")}
      >
        <span
          aria-hidden
          className={[
            "h-2 w-2 rounded-full",
            on ? "bg-[var(--success)]" : "bg-[var(--border)]",
          ].join(" ")}
        />
        {pending ? "…" : label}
      </button>

      {error ? (
        <p className="text-xs text-[var(--danger)]">{error}</p>
      ) : null}
    </div>
  );
}
