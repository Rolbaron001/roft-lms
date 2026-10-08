"use client";
import { DateField } from "@/components/date-field";

import { useActionState } from "react";
import { recordPaymentAction, type PaymentState } from "./payment-actions";
import { useT } from "@/components/i18n";

const field =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/**
 * Recording that a client was invoiced for this cohort, and then that they paid.
 *
 * Two dates rather than one tick. The gap between them is what a coordinator
 * chases, and collapsing it into "paid" would throw away the only thing worth
 * looking at while it is open.
 *
 * A learner paying their own way is not recorded here: theirs is a proof of
 * payment document against them, on their own record. Either satisfies the
 * enrolment procedure, which is what Roland confirmed on 15 September.
 */
export function PaymentForm({
  cohortId,
  invoicedAt,
  paymentReceivedAt,
  reference,
}: {
  cohortId: string;
  invoicedAt: Date | null;
  paymentReceivedAt: Date | null;
  reference: string | null;
}) {
  const t = useT();
  const [state, act, working] = useActionState<PaymentState, FormData>(
    recordPaymentAction,
    {},
  );

  const asDate = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : "");

  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="cohortId" value={cohortId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("payment.invoiced")}</span>
          <DateField name="invoicedOn" defaultValue={asDate(invoicedAt)} className={`${field} w-full`} />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("payment.received")}</span>
          <DateField
            name="receivedOn"
            defaultValue={asDate(paymentReceivedAt)}
            className={`${field} w-full`}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("payment.reference")}</span>
          <input
            name="reference"
            defaultValue={reference ?? ""}
            placeholder="INV-2026-0041"
            className={`${field} w-full`}
          />
          <span className="block text-xs text-[var(--muted)]">{t("payment.referenceNote")}</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={working}
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
      >
        {working ? t("assessing.recording") : t("payment.record")}
      </button>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
