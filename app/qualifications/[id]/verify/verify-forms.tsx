"use client";

import { useActionState } from "react";
import { useT } from "@/components/i18n";
import { buildQualificationAction, verifyQualificationAction, type VerifyState } from "./actions";

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
