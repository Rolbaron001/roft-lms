"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [visible, setVisible] = useState(false);
  const showId = useId();

  const [state, formAction] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          required
          className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
        />

        {/*
          A checkbox rather than an eye icon in the corner of the field.
          
          It says in words what it does, which an icon does not, and it is
          reachable by keyboard in the normal order rather than needing to be
          found. This matters here more than on most forms: a learner who
          cannot sign in because they mistyped a password they were emailed has
          no other way in, and the first thing they need is to see what they
          typed.

          Off on arrival, always. Nothing remembers this between visits,
          because a password box that shows its contents when somebody else is
          at the machine is a worse failure than a mistyped password.
        */}
        <label
          htmlFor={showId}
          className="flex w-fit items-center gap-2 pt-1 text-sm text-[var(--muted)]"
        >
          <input
            id={showId}
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
            className="h-4 w-4"
          />
          Show password
        </label>
      </div>

      <SubmitButton />
    </form>
  );
}
