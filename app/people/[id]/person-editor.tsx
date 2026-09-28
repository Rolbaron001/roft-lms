"use client";

import { useActionState, useState } from "react";
import {
  anonymiseAction,
  resetPasswordAction,
  setMailboxAction,
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
import { useT } from "@/components/i18n";
import { Rich } from "@/components/rich-text";

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
  mailboxAddress,
  proposedMailbox,
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
  mailboxAddress: string | null;
  proposedMailbox: string;
}) {
  const t = useT();
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
  const [mailboxState, mailboxAction, mailboxPending] = useActionState<
    PeopleState,
    FormData
  >(setMailboxAction, {});
  const [anonState, anonAction, anonPending] = useActionState<
    PeopleState,
    FormData
  >(anonymiseAction, {});

  const [showAnonymise, setShowAnonymise] = useState(false);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {t("editor.details")}
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
            {detailPending ? t("common.saving") : t("editor.saveDetails")}
          </button>
        </form>
      </section>

      {canManageRoles ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("editor.roles")}
          </h2>

          {isSelf ? (
            <p className="mt-3 text-sm text-[var(--muted)]">{t("editor.ownRoles")}</p>
          ) : (
            <>
              <Message state={roleState} />
              <form action={roleAction} className="mt-4 space-y-4">
                <input type="hidden" name="userId" value={userId} />
                <RoleChecklist selected={roles} registrationNumbers={registrationNumbers} />
                <button
                  type="submit"
                  disabled={rolePending}
                  className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {rolePending ? t("common.saving") : t("editor.saveRoles")}
                </button>
              </form>
            </>
          )}
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {t("editor.mailbox")}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("editor.mailboxIntro")}</p>

        {/*
          Added because the obvious question was going unanswered: an
          administrator issues a mailbox, is asked for no password, and
          reasonably concludes something is missing. Nothing is - the mailbox
          lives inside the platform - but the screen never said so, and a
          design nobody can infer from the screen is a design that generates
          support questions.
        */}
        <p className="mt-2 rounded-md border border-[var(--border)] p-3 text-sm text-[var(--muted)]">
          <span className="font-medium text-[var(--foreground)]">{t("editor.noPassword")}</span>{" "}
          {t("editor.noPasswordWhy")}
        </p>

        <Message state={mailboxState} />

        <form action={mailboxAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="userId" value={userId} />
          <div className="flex-1" style={{ minWidth: "18rem" }}>
            <label htmlFor="mailboxAddress" className="block text-sm font-medium">
              {t("editor.mailboxAddress")}
            </label>
            <input
              id="mailboxAddress"
              name="mailboxAddress"
              type="email"
              defaultValue={mailboxAddress ?? ""}
              placeholder={proposedMailbox}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              {mailboxAddress
                ? t("editor.mailboxChange")
                : t("editor.mailboxSuggested", { address: proposedMailbox })}
            </p>
          </div>
          <button
            type="submit"
            disabled={mailboxPending}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            {mailboxPending ? t("common.saving") : t("editor.saveMailbox")}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {t("editor.access")}
        </h2>

        {passwordState.password ? (
          <div className="mt-3 rounded-md border-2 border-[var(--success)]/40 bg-[var(--success)]/5 p-4">
            <p className="text-sm font-medium">{t("editor.newPassword")}</p>
            <p className="mt-2 font-mono text-lg font-semibold">{passwordState.password}</p>
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
              {passwordPending ? t("editor.resetting") : t("editor.reset")}
            </button>
          </form>

          {isSelf ? (
            <p className="self-center text-sm text-[var(--muted)]">{t("editor.ownSuspend")}</p>
          ) : (
            <form action={statusAction}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="status" value={status === "suspended" ? "active" : "suspended"} />
              <button
                type="submit"
                disabled={statusPending}
                className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60"
                style={
                  status === "suspended"
                    ? undefined
                    : { borderColor: "var(--danger)", color: "var(--danger)" }
                }
              >
                {statusPending
                  ? t("editor.working")
                  : status === "suspended"
                    ? t("editor.reactivate")
                    : t("editor.suspend")}
              </button>
            </form>
          )}
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">{t("editor.suspendNote")}</p>
      </section>

      {canAnonymise && !isSelf ? (
        <section className="rounded-lg border border-[var(--danger)]/30 bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--danger)]">
            {t("editor.erase")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t("editor.eraseIntro")}</p>

          <Message state={anonState} />

          {showAnonymise ? (
            <form action={anonAction} className="mt-4 max-w-md space-y-3">
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="expectedConfirmation" value={surname} />

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">{t("editor.why")}</span>
                <textarea
                  name="reason"
                  rows={2}
                  required
                  className={inputClass}
                  placeholder={t("editor.whyHint")}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  <Rich
                    text={t("editor.typeToConfirm")}
                    parts={{ surname: <span className="font-mono">{surname}</span> }}
                  />
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
                  {anonPending ? t("editor.erasing") : t("editor.erasePermanently")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAnonymise(false)}
                  className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
                >
                  {t("common.cancel")}
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
              {t("editor.eraseStart")}
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
