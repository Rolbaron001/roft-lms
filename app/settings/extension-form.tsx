"use client";

import { useActionState, useState } from "react";
import {
  updateMyExtensionAction,
  type ExtensionState,
} from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type ExtensionView = {
  /** A token is stored. */
  registered: boolean;
  /** Set up and permitted, so it can be switched on for a sitting. */
  available: boolean;
  tokenHint: string | null;
  tokenAddedAt: string | null;
  provider: string | null;
  model: string | null;
  availability: {
    available: boolean;
    reason?: string;
    remedy?: string;
    detail?: string;
  } | null;
  providers: { name: string; label: string; description: string }[];
};

/**
 * Your own AI extension, in Settings and against your own profile.
 *
 * Yours rather than the tenant's: every member of the provider's staff sets
 * their own, with their own subscription, and what it then lets them do is
 * bounded by their role exactly as everything else is. An administrator setting
 * theirs up does not set anybody else's up, and does not need to.
 *
 * This page is where it is set up. It is not where it is switched on - that
 * happens per sitting, from the switch at the top of any page, and starts off
 * every time somebody signs in.
 */
export function ExtensionForm({ current }: { current: ExtensionView }) {
  const [state, action, saving] = useActionState<ExtensionState, FormData>(
    updateMyExtensionAction,
    {},
  );
  const [available, setAvailable] = useState(current.available);
  const [provider, setProvider] = useState(
    current.provider ?? current.providers[0]?.name ?? "",
  );

  const chosen = current.providers.find((row) => row.name === provider);

  return (
    <form action={action} className="space-y-4">
      {current.registered ? (
        <div className="rounded-md border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">A token is stored</p>
          <p className="mt-1 text-[var(--muted)]">
            Ending {current.tokenHint}
            {current.tokenAddedAt ? `, saved ${current.tokenAddedAt}` : ""}. It
            is encrypted and is never shown again, here or anywhere else.
          </p>
          <button
            type="submit"
            name="intent"
            value="forget"
            disabled={saving}
            className="mt-2 rounded-md border border-[var(--danger)] px-3 py-1 text-xs text-[var(--danger)] disabled:opacity-60"
          >
            Discard it
          </button>
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="text-[var(--muted)]">
          {current.registered
            ? "Replace it with a new token — leave empty to keep the stored one"
            : "Your token"}
        </span>
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder="sk-ant-oat…"
          className={`${inputClass} mt-1 block w-full max-w-md font-mono`}
        />
      </label>

      {/*
        The one instruction that matters, and it is deliberately a command they
        run themselves. Nothing about this flow asks for a Claude password, and
        nothing here would accept one.
      */}
      <div className="max-w-2xl rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
        <p className="font-medium text-[var(--foreground)]">
          Where the token comes from
        </p>
        <p className="mt-1">
          On your own computer, with Claude Code installed, run:
        </p>
        <pre className="mt-1 overflow-x-auto rounded bg-[var(--surface)] px-2 py-1 font-mono">
          claude setup-token
        </pre>
        <p className="mt-1">
          It asks you to sign in to Anthropic in your browser and then prints a
          token beginning <span className="font-mono">sk-ant-oat</span>. Paste
          that. It is not an API key and there is no per-token cost — it draws on
          the Claude subscription you already pay for. Never give anybody your
          Anthropic password; this platform has no field for one.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="available"
          checked={available}
          onChange={(event) => setAvailable(event.target.checked)}
        />
        Make it available to switch on
      </label>

      {available ? (
        <>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Which one</span>
            <select
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className={`${inputClass} mt-1 block w-full max-w-md`}
            >
              {current.providers.map((row) => (
                <option key={row.name} value={row.name}>
                  {row.label}
                </option>
              ))}
            </select>
            {chosen ? (
              <span className="mt-1 block max-w-2xl text-xs text-[var(--muted)]">
                {chosen.description}
              </span>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="text-[var(--muted)]">
              Model — leave empty for the provider&rsquo;s own default
            </span>
            <input
              name="model"
              defaultValue={current.model ?? ""}
              placeholder="claude-opus-5"
              className={`${inputClass} mt-1 block w-full max-w-md`}
            />
          </label>

          {current.availability && !current.availability.available ? (
            <div className="rounded-md border border-[var(--border)] p-3 text-sm">
              <p className="font-medium">Not ready yet</p>
              <p className="mt-1 text-[var(--muted)]">
                {current.availability.reason}
              </p>
              {current.availability.remedy ? (
                <p className="mt-1 text-[var(--muted)]">
                  {current.availability.remedy}
                </p>
              ) : null}
            </div>
          ) : null}

          {/*
            Said plainly, because per-person means the platform holds something
            it holds for nothing else, and somebody agreeing to that should know
            they are agreeing to it.
          */}
          <p className="max-w-2xl rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
            <span className="font-medium">What the platform keeps.</span> Your
            token, encrypted, until you discard it. It is used only for work you
            ask for, only while you have the switch on, and it is never shown
            back to you or written to any log. Available is not the same as on:
            every sitting starts with it off, you switch it on for a job, and
            signing out switches it off for you if you forget.
          </p>
        </>
      ) : (
        <p className="max-w-2xl text-xs text-[var(--muted)]">
          {current.registered
            ? "Your token is kept but cannot be used. Nothing in the platform will offer AI assistance until you make it available again."
            : "With this off, the platform behaves exactly as it does without an extension — the affordances are absent rather than offered and failing."}
        </p>
      )}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
