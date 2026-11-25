"use client";

import { useActionState } from "react";
import { useT } from "@/components/i18n";
import { acceptFindingAction, buildQualificationAction, verifyQualificationAction, withdrawAcceptanceAction, type VerifyState } from "./actions";

/** Builds what the documents settle and is not built yet. Fills gaps only. */
export function BuildForm({ qualificationId, again }: { qualificationId: string; again: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<VerifyState, FormData>(buildQualificationAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="qualificationId" value={qualificationId} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${
          again ? "border border-[var(--border)]" : "bg-[var(--brand-primary)] text-white"
        }`}
      >
        {pending ? t("verify.building") : again ? t("verify.buildAgain") : t("verify.build")}
      </button>
      {pending ? <p className="text-xs text-[var(--muted)]">{t("verify.buildingNote")}</p> : null}
      {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
      {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
    </form>
  );
}

/**
 * Accepting a finding that holds the programme back, with the reason (D62).
 * Folded until asked for, so passing a problem is a deliberate act.
 */
export function AcceptForm({ qualificationId, findingKey }: { qualificationId: string; findingKey: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<VerifyState, FormData>(acceptFindingAction, {});
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-[var(--muted)] underline underline-offset-2">{t("verify.acceptOpen")}</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="qualificationId" value={qualificationId} />
        <input type="hidden" name="findingKey" value={findingKey} />
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-[var(--foreground)]">{t("verify.acceptReason")}</span>
          <textarea
            name="reason"
            required
            minLength={15}
            rows={2}
            className="w-full max-w-xl rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
          />
          <span className="mt-1 block text-[var(--muted)]">{t("verify.acceptHint")}</span>
        </label>
        <button type="submit" disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] disabled:opacity-60">
          {t("verify.acceptButton")}
        </button>
        {state.error ? <p role="alert" className="text-xs text-[var(--danger)]">{state.error}</p> : null}
      </form>
    </details>
  );
}

/** Withdrawing an acceptance: the finding holds the programme back again. */
export function WithdrawForm({ qualificationId, findingKey }: { qualificationId: string; findingKey: string }) {
  const t = useT();
  const [, action, pending] = useActionState<VerifyState, FormData>(withdrawAcceptanceAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="qualificationId" value={qualificationId} />
      <input type="hidden" name="findingKey" value={findingKey} />
      <button type="submit" disabled={pending} className="text-xs underline underline-offset-2 disabled:opacity-60">
        {t("verify.withdraw")}
      </button>
    </form>
  );
}

/** The one act that makes it live. */
export function VerifyForm({ qualificationId, ready }: { qualificationId: string; ready: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyQualificationAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="qualificationId" value={qualificationId} />
      <button
        type="submit"
        disabled={pending || !ready}
        className="rounded-md bg-[var(--brand-primary)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? t("verify.publishing") : t("verify.publish")}
      </button>
      {!ready ? <p className="text-xs text-[var(--muted)]">{t("verify.notReady")}</p> : null}
      {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
      {state.error ? (
        <div role="alert" className="text-sm text-[var(--danger)]">
          <p>{state.error}</p>
          {state.problems?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {state.problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
