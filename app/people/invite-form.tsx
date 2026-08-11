"use client";

import { useActionState } from "react";
import { invitePersonAction, type PeopleState } from "./actions";
import { PersonFields, RoleChecklist } from "./person-fields";

export function InviteForm({
  canManageRoles,
  managers,
}: {
  canManageRoles: boolean;
  managers: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<PeopleState, FormData>(
    invitePersonAction,
    {},
  );

  return (
    <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Add somebody
      </h2>

      {state.password ? (
        <div className="mt-4 rounded-md border-2 border-[var(--success)]/40 bg-[var(--success)]/5 p-4">
          <p className="text-sm font-medium">
            Added. Give them this password — it is shown once and cannot be
            retrieved.
          </p>
          <p className="mt-2 font-mono text-lg font-semibold">
            {state.password}
          </p>
          <p className="mt-2 text-xs text-[var(--muted)]">
            There is no mail server connected yet, so nothing was emailed. Ask
            them to change it after signing in.
          </p>
        </div>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <form action={action} className="mt-4 space-y-4">
        <PersonFields managers={managers} />

        {canManageRoles ? <RoleChecklist selected={["learner"]} /> : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Adding…" : "Add person"}
        </button>
      </form>
    </section>
  );
}
