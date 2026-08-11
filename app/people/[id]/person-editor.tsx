"use client";

import { useActionState, useState } from "react";
import {
  anonymiseAction,
  resetPasswordAction,
  setRolesAction,
  setStatusAction,
  updatePersonAction,
  type PeopleState,
} from "../actions";
import {
  inputClass,
  PersonFields,
  RoleChecklist,
  type PersonDefaults,
} from "../person-fields";

function Message({ state }: { state: PeopleState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="mt-3 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function PersonEditor({
  userId,
  isSelf,
  status,
  surname,
  defaults,
  roles,
  registrationNumbers,
  managers,
  canManageRoles,
  canAnonymise,
}: {
  userId: string;
  isSelf: boolean;
  status: string;
  surname: string;
  defaults: PersonDefaults;
  roles: string[];
  registrationNumbers: Record<string, string | null>;
  managers: { id: string; label: string }[];
  canManageRoles: boolean;
  canAnonymise: boolean;
}) {
  const [detailState, detailAction, detailPending] = useActionState<
    PeopleState,
    FormData
  >(updatePersonAction, {});
  const [roleState, roleAction, rolePending] = useActionState<
    PeopleState,
    FormData
  >(setRolesAction, {});
  const [statusState, statusAction, statusPending] = useActionState<
    PeopleState,
    FormData
  >(setStatusAction, {});
  const [passwordState, passwordAction, passwordPending] = useActionState<
    PeopleState,
    FormData
  >(resetPasswordAction, {});
  const [anonState, anonAction, anonPending] = useActionState<
    PeopleState,
    FormData
  >(anonymiseAction, {});

  const [showAnonymise, setShowAnonymise] = useState(false);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Details
        </h2>
        <Message state={detailState} />

        <form action={detailAction} className="mt-4 space-y-4">
          <input type="hidden" name="userId" value={userId} />
          <PersonFields defaults={defaults} managers={managers} />
          <button
            type="submit"
            disabled={detailPending}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand-primary)" }}
          >
            {detailPending ? "Saving…" : "Save details"}
          </button>
        </form>
      </section>

      {canManageRoles ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Roles
          </h2>

          {isSelf ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              You cannot change your own roles — removing your own access is
              the one mistake nobody else may be able to undo. Ask another
              administrator.
            </p>
          ) : (
            <>
              <Message state={roleState} />
              <form action={roleAction} className="mt-4 space-y-4">
                <input type="hidden" name="userId" value={userId} />
                <RoleChecklist
                  selected={roles}
                  registrationNumbers={registrationNumbers}
                />
                <button
                  type="submit"
                  disabled={rolePending}
                  className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {rolePending ? "Saving…" : "Save roles"}
                </button>
              </form>
            </>
          )}
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Access
        </h2>

        {passwordState.password ? (
          <div className="mt-3 rounded-md border-2 border-[var(--success)]/40 bg-[var(--success)]/5 p-4">
            <p className="text-sm font-medium">
              New password — shown once, give it to them directly.
            </p>
            <p className="mt-2 font-mono text-lg font-semibold">
              {passwordState.password}
            </p>
          </div>
        ) : null}
        <Message state={passwordState} />
        <Message state={statusState} />

        <div className="mt-4 flex flex-wrap gap-3">
          <form action={passwordAction}>
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              disabled={passwordPending}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {passwordPending ? "Resetting…" : "Reset password"}
            </button>
          </form>

          {isSelf ? (
            <p className="self-center text-sm text-[var(--muted)]">
              You cannot suspend your own account.
            </p>
          ) : (
            <form action={statusAction}>
              <input type="hidden" name="userId" value={userId} />
              <input
                type="hidden"
                name="status"
                value={status === "suspended" ? "active" : "suspended"}
              />
              <button
                type="submit"
                disabled={statusPending}
                className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
                style={
                  status === "suspended"
                    ? undefined
                    : {
                        borderColor: "var(--danger)",
                        color: "var(--danger)",
                      }
                }
              >
                {statusPending
                  ? "Working…"
                  : status === "suspended"
                    ? "Reactivate account"
                    : "Suspend account"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">
          Suspending ends any session the person has open immediately, and
          resetting a password signs them out everywhere.
        </p>
      </section>

      {canAnonymise && !isSelf ? (
        <section className="rounded-lg border border-[var(--danger)]/30 bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--danger)]">
            Erase personal information
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            For a POPIA erasure request. Removes the name, contact and
            demographic details permanently. Certificates and assessment
            records are kept and stay verifiable, because a qualification once
            earned has to remain on the national record — which is also why
            this cannot be undone.
          </p>

          <Message state={anonState} />

          {showAnonymise ? (
            <form action={anonAction} className="mt-4 max-w-md space-y-3">
              <input type="hidden" name="userId" value={userId} />
              <input
                type="hidden"
                name="expectedConfirmation"
                value={surname}
              />

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  Why is this being done?
                </span>
                <textarea
                  name="reason"
                  rows={2}
                  required
                  className={inputClass}
                  placeholder="Kept permanently in the audit log."
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  Type <span className="font-mono">{surname}</span> to confirm
                </span>
                <input name="confirmation" required className={inputClass} />
              </label>

              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={anonPending}
                  className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--danger)" }}
                >
                  {anonPending ? "Erasing…" : "Erase permanently"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAnonymise(false)}
                  className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowAnonymise(true)}
              className="mt-4 rounded-md border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
            >
              Erase personal information…
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
