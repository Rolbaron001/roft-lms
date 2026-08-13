"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction, type PasswordState } from "./actions";

const FIELD =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Change password"}
    </button>
  );
}

export function PasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction] = useActionState<PasswordState, FormData>(
    changePasswordAction,
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
        <label htmlFor="currentPassword" className="block text-sm font-medium">
          {forced ? "The password you were given" : "Current password"}
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="newPassword" className="block text-sm font-medium">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          className={FIELD}
        />
        <p className="text-xs text-[var(--muted)]">
          At least 12 characters. A phrase of a few unrelated words is both
          stronger and easier to remember than something short with symbols in
          it.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirmPassword" className="block text-sm font-medium">
          New password again
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={FIELD}
        />
      </div>

      <SubmitButton />
    </form>
  );
}
