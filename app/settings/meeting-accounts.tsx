"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { disconnectMeetingAction, type MeetingAccountState } from "./meeting-actions";

/**
 * The provider's Google Meet and Microsoft Teams accounts (job sheet D41).
 *
 * The provider's, not a person's: one account per service, in which the LMS
 * creates every class's meeting and from which it reads attendance. Connecting
 * is a plain link, because it hands over to Google or Microsoft.
 */
export function MeetingAccounts({
  accounts,
  notice,
}: {
  accounts: { service: string; label: string; configured: boolean; accountLabel: string | null; connectedAt: string | null }[];
  notice: { text: string; good: boolean } | null;
}) {
  const t = useT();
  const [state, act, working] = useActionState<MeetingAccountState, FormData>(disconnectMeetingAction, {});

  return (
    <Card title={t("meetingAccounts.title")} description={t("meetingAccounts.note")}>
      <div className="space-y-3 text-sm">
        {notice ? (
          <p
            role="status"
            className={`rounded-md border px-3 py-2 ${notice.good ? "border-[var(--success)]/30 bg-[var(--success)]/5 text-[var(--success)]" : "border-[var(--border)] text-[var(--muted)]"}`}
          >
            {notice.text}
          </p>
        ) : null}
        <ul className="space-y-2">
          {accounts.map((account) => (
            <li key={account.service} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2">
              <span>
                <span className="font-medium">{account.label}</span>
                {account.accountLabel ? <span className="text-[var(--muted)]"> · {account.accountLabel}</span> : null}
                <span className="block text-xs text-[var(--muted)]">
                  {!account.configured
                    ? t("meetingAccounts.notSetUp")
                    : account.connectedAt
                      ? t("meetingAccounts.connectedAt", { date: account.connectedAt })
                      : t("meetingAccounts.notConnected")}
                </span>
              </span>
              {account.configured && account.connectedAt ? (
                <form action={act}>
                  <input type="hidden" name="service" value={account.service} />
                  <button type="submit" disabled={working} className="text-xs font-medium text-[var(--danger)] hover:underline disabled:opacity-60">
                    {t("meetingAccounts.disconnect")}
                  </button>
                </form>
              ) : account.configured ? (
                <a href={`/api/meetings/${account.service}/connect`} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium">
                  {t("meetingAccounts.connect")}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        {state.error ? <p role="alert" className="text-[var(--danger)]">{state.error}</p> : null}
        {state.done ? <p role="status" className="text-[var(--muted)]">{state.done}</p> : null}
      </div>
    </Card>
  );
}
