"use client";

import { useState, useTransition } from "react";
import { testMailAction, type MailTestState } from "./mail-actions";

/**
 * The mail test, on the settings page.
 *
 * A button and a result, and deliberately nothing else. There is nothing here
 * to configure: the mail server belongs to the deployment rather than to this
 * provider, so what an administrator needs is not a form but an answer to one
 * question — can my learners receive anything?
 *
 * Says plainly that it sends nothing. Somebody who suspects a "test" will email
 * a real learner will not press it, and then the button might as well not
 * exist.
 */
export function MailTest({ configured }: { configured: boolean }) {
  const [state, setState] = useState<MailTestState | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setState(null);
    start(async () => setState(await testMailAction()));
  }

  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-sm text-[var(--muted)]">
        Opens a connection to the mail server and signs in, to check that
        learner sign-in details and notifications can actually be delivered.
        <span className="font-medium text-[var(--foreground)]">
          {" "}
          No email is sent to anybody.
        </span>
      </p>

      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm transition hover:border-[var(--brand-accent)] disabled:opacity-60"
      >
        {pending ? "Testing…" : "Test the mail connection"}
      </button>

      {state?.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}

      {state && !state.error ? (
        <div
          className="max-w-2xl rounded-md border p-3 text-sm"
          style={{
            borderColor: state.ok ? "var(--success)" : "var(--danger)",
          }}
        >
          <p
            className="font-medium"
            style={{ color: state.ok ? "var(--success)" : "var(--danger)" }}
          >
            {state.ok ? "Working" : "Not working"}
          </p>
          <p className="mt-1">{state.message}</p>

          {/* The server's own words. An administrator cannot fix the mail
              server, but they are the one who has to tell whoever can, and
              "it is not working" is not a thing anybody can act on. */}
          {state.detail ? (
            <p className="mt-2 font-mono text-xs text-[var(--muted)]">
              {state.detail}
            </p>
          ) : null}

          {!state.ok ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Nothing here is something you can change on this page — the mail
              server belongs to the deployment. Pass the line above to whoever
              maintains it.
            </p>
          ) : null}
        </div>
      ) : null}

      {!configured && !state ? (
        <p className="text-xs text-[var(--muted)]">
          No mail server is set up on this deployment yet, so this will report
          that rather than a fault with your account.
        </p>
      ) : null}
    </div>
  );
}
