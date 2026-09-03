"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
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

      <SetupGuide />

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

/**
 * How to get a token, for somebody who has never used a terminal.
 *
 * No link can do this part. A web page cannot run a program on the reader's
 * computer, and the whole point of the design is that the credential is created
 * on their machine and never travels except as the token itself. So the next
 * best thing is to make the manual step short, exact, and copyable, and to name
 * the one failure that will otherwise stop half the people who try it.
 *
 * That failure is Windows. PowerShell refuses to run the `claude.ps1` shim npm
 * installs, with an error about scripts being disabled that reads like a broken
 * installation rather than a policy default. `claude.cmd` sidesteps it entirely
 * and needs no security setting changed, so it is what this shows to Windows
 * readers by default.
 */
function SetupGuide() {
  // Read through useSyncExternalStore rather than an effect. The server has no
  // navigator and must render something, and setting state in an effect to
  // correct it afterwards is both a cascading render and a visible flicker.
  // This gives the server its own answer and the browser the real one, with no
  // render in between. Same approach as components/zoned-time.tsx.
  const detected = useSyncExternalStore(
    subscribeToNothing,
    detectSystem,
    () => "unix" as const,
  );

  // The guess is sometimes wrong - a Mac used to reach a Windows machine, a
  // browser that reports nothing useful - so it is a starting point, not a
  // verdict.
  const [chosenSystem, setChosenSystem] = useState<"windows" | "unix" | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const system = chosenSystem ?? detected;
  const setSystem = setChosenSystem;

  const command =
    system === "windows" ? "claude.cmd setup-token" : "claude setup-token";

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the command is on screen regardless.
      setCopied(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
      <p className="text-sm font-medium text-[var(--foreground)]">
        Where the token comes from
      </p>
      <p className="mt-1">
        This part happens on your own computer, not here — which is the point:
        your subscription is authorised by you, on your machine, and only the
        token it produces ever reaches this platform.
      </p>

      <ol className="mt-3 space-y-3">
        <li>
          <span className="font-medium text-[var(--foreground)]">
            1. Install Claude Code
          </span>{" "}
          if you have not already —{" "}
          <a
            href="https://code.claude.com/docs/en/setup"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            the install guide
          </a>
          . You need a Claude subscription of your own.
        </li>

        <li>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--foreground)]">
              2. Run this
            </span>
            <span className="inline-flex overflow-hidden rounded border border-[var(--border)]">
              {(["windows", "unix"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSystem(option)}
                  className={[
                    "px-2 py-0.5 text-[11px]",
                    system === option
                      ? "bg-[var(--brand-primary)] text-white"
                      : "text-[var(--muted)]",
                  ].join(" ")}
                >
                  {option === "windows" ? "Windows" : "Mac or Linux"}
                </button>
              ))}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <pre className="flex-1 overflow-x-auto rounded bg-[var(--surface)] px-2 py-1 font-mono">
              {command}
            </pre>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[11px]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {system === "windows" ? (
            <p className="mt-1">
              <span className="font-medium text-[var(--foreground)]">
                Note the <span className="font-mono">.cmd</span>.
              </span>{" "}
              Plain <span className="font-mono">claude setup-token</span> in
              PowerShell usually fails with &ldquo;running scripts is disabled
              on this system&rdquo;. That is a Windows default rather than
              anything wrong with your installation, and the{" "}
              <span className="font-mono">.cmd</span> form avoids it without
              changing any security setting.
            </p>
          ) : null}
        </li>

        <li>
          <span className="font-medium text-[var(--foreground)]">
            3. Sign in when it opens your browser
          </span>
          , then copy the token it prints — it begins{" "}
          <span className="font-mono">sk-ant-oat</span> — and paste it above.
        </li>
      </ol>

      <p className="mt-3">
        It is not an API key and there is no per-token cost: it draws on the
        Claude subscription you already pay for. Never give anybody your
        Anthropic password — this platform has no field for one and would not
        accept it here.
      </p>
    </div>
  );
}

/** Nothing to subscribe to: the platform does not change mid-visit. */
function subscribeToNothing(): () => void {
  return () => {};
}

function detectSystem(): "windows" | "unix" {
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    "";
  return /win/i.test(platform) ? "windows" : "unix";
}
