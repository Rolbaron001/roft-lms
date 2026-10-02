"use client";

import { useState, useTransition } from "react";
import { setAiAction } from "@/app/ai/actions";
import { useT } from "@/components/i18n";

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
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    setError(null);
    start(async () => {
      const result = await setAiAction(!on);
      if (result.error) setError(result.error);
    });
  }

  const label = on ? t("aiSwitch.on") : t("aiSwitch.off");

  // The header sits on the provider's brand colour, where the page's muted
  // grey all but disappears; there it takes the white of the buttons beside it.
  const header = variant === "header";
  const buttonTone = header
    ? on
      ? "border-white/60 text-white"
      : "border-white/30 text-white/85 hover:bg-white/10"
    : on
      ? "border-[var(--success)] text-[var(--success)]"
      : "border-[var(--border)] text-[var(--muted)]";
  const dotTone = header
    ? on
      ? "bg-[var(--success)] ring-1 ring-white/70"
      : "border border-white/70"
    : on
      ? "bg-[var(--success)]"
      : "bg-[var(--border)]";

  return (
    <div className={variant === "header" ? "flex items-center" : "space-y-1"}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={on}
        title={on ? t("aiSwitch.onTitle") : t("aiSwitch.offTitle")}
        className={[
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60",
          buttonTone,
        ].join(" ")}
      >
        <span aria-hidden className={["h-2 w-2 rounded-full", dotTone].join(" ")} />
        {pending ? "…" : label}
      </button>

      {error ? (
        <p className="text-xs text-[var(--danger)]">{error}</p>
      ) : null}
    </div>
  );
}
