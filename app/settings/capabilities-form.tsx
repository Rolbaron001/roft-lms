"use client";

import { useActionState } from "react";
import { CAPABILITIES, CAPABILITY_KEYS, type Capability } from "@/lib/features";
import {
  updateCapabilitiesAction,
  type CapabilitiesState,
} from "./capabilities-actions";

/**
 * What this provider's platform is for.
 *
 * Roland, 21 September 2026: "please apply it, but in such a way that it is
 * seen to be applied and can be changed. Not hard-coded for Curiosa."
 *
 * These five existed only on the form that creates a tenant, so a provider
 * already running could not see what they had, let alone change it. A setting
 * nobody can see is indistinguishable from one that does not work.
 *
 * Each switch says what it covers and when a provider would turn it off. The
 * second half is the one a settings screen usually leaves out, and without it
 * every switch stays at whatever it arrived as.
 */
export function CapabilitiesForm({
  current,
}: {
  current: Record<Capability, boolean>;
}) {
  const [state, act, pending] = useActionState<CapabilitiesState, FormData>(
    updateCapabilitiesAction,
    {},
  );

  return (
    <section
      id="capabilities"
      data-settings-section="What this platform does"
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        What this platform does
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        Not every provider runs accredited qualifications, and not every
        provider files statutory returns. Switch off what you do not use and
        its screens and menu entries go away.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        <strong>Nothing is deleted.</strong> Switching one off hides it.
        Whatever has already been recorded stays where it is, and switching it
        back on brings the screens back with the records intact.
      </p>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p
          className="mt-3 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm"
          style={{ color: "var(--success)" }}
        >
          Saved. The menu has changed to match.
        </p>
      ) : null}

      <form action={act} className="mt-4 space-y-3">
        {CAPABILITY_KEYS.map((key) => (
          <label key={key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name={key}
              defaultChecked={current[key]}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{CAPABILITIES[key].label}</span>
              <span className="block text-xs text-[var(--muted)]">
                {CAPABILITIES[key].covers}
              </span>
              <span className="block text-xs text-[var(--muted)]">
                <strong>Switch it off when:</strong> {CAPABILITIES[key].offWhen}
              </span>
            </span>
          </label>
        ))}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Saving\u2026" : "Save what this platform does"}
        </button>
      </form>
    </section>
  );
}
