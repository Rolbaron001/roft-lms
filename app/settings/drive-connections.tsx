"use client";

import { useActionState } from "react";
import { disconnectDriveAction, type DriveState } from "./drive-actions";
import { useT } from "@/components/i18n";

/**
 * The drives this person has connected, and connecting another.
 *
 * Per person rather than per tenant, and the screen says so, because it is the
 * kind of thing somebody assumes the other way round. A tenant with four
 * administrators has four connections or none; connecting yours does not give
 * a colleague access to your files, and theirs does not give you access to
 * theirs.
 *
 * Connecting is a plain link rather than a form, because it leaves the
 * platform: it hands over to Google or Microsoft, who ask the question and
 * send the answer back.
 */
export function DriveConnections({
  connected,
  offered,
  notice,
}: {
  connected: {
    provider: string;
    label: string;
    accountLabel: string | null;
    connectedAt: string;
    lastUsedAt: string | null;
  }[];
  /** Those this deployment has been set up to offer at all. */
  offered: { name: string; label: string; description: string }[];
  notice: string | null;
}) {
  const t = useT();
  const [state, act, working] = useActionState<DriveState, FormData>(
    disconnectDriveAction,
    {},
  );

  if (offered.length === 0) {
    return <p className="max-w-2xl text-xs text-[var(--muted)]">{t("drives.none")}</p>;
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            notice === t("settings.drive.connected")
              ? "border-[var(--success)]/30 bg-[var(--success)]/5 text-[var(--success)]"
              : "border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          {notice}
        </p>
      ) : null}

      {connected.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {connected.map((one) => (
            <li
              key={one.provider}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2"
            >
              <span>
                <span className="font-medium">{one.label}</span>
                {one.accountLabel ? (
                  <span className="text-[var(--muted)]"> · {one.accountLabel}</span>
                ) : null}
                <span className="block text-xs text-[var(--muted)]">
                  {t("drives.connectedAt", { date: one.connectedAt })}
                  {one.lastUsedAt ? t("drives.lastUsed", { date: one.lastUsedAt }) : t("drives.notUsed")}
                </span>
              </span>

              <form action={act}>
                <input type="hidden" name="provider" value={one.provider} />
                <button
                  type="submit"
                  disabled={working}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  {t("drives.disconnect")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2">
        {offered
          .filter((one) => !connected.some((row) => row.provider === one.name))
          .map((one) => (
            <div key={one.name} className="space-y-1">
              <a
                href={`/api/drive/${one.name}/connect`}
                className="inline-block rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
              >
                {t("drives.connect", { provider: one.label })}
              </a>
              <p className="max-w-2xl text-xs text-[var(--muted)]">
                {one.description}
              </p>
            </div>
          ))}
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
      {state.done ? (
        <p className="text-sm text-[var(--success)]">{state.done}</p>
      ) : null}

      {/*
        Said plainly, because per-person means the platform holds a credential
        that reads somebody's own files, and anybody agreeing to that should
        know what they are agreeing to.
      */}
      <p className="max-w-2xl rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
        <span className="font-medium">{t("drives.keeps")}</span> {t("drives.keepsNote")}
      </p>
    </div>
  );
}
