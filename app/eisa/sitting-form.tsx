"use client";
import { DateField } from "@/components/date-field";

import { useActionState } from "react";
import { recordSittingAction, type EisaActionState } from "./actions";
import { useT } from "@/components/i18n";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Adding a sitting from the quality partner's letter.
 *
 * Four fields, because that is what the letter contains. The registration date
 * is asked for rather than worked out from the sitting date: three months is
 * the usual gap and not a rule, and guessing it would produce a countdown that
 * is confidently wrong.
 */
export function SittingForm() {
  const t = useT();
  const [state, action, saving] = useActionState<EisaActionState, FormData>(
    recordSittingAction,
    {},
  );

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input name="name" required placeholder={t("eisa.sittingName")} className={inputClass} />
        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">{t("eisa.sitting")}</span>
          <DateField name="sittingDate" required className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">{t("eisa.registrationCloses")}</span>
          <DateField name="registrationCloses" required className={inputClass} />
        </label>
      </div>

      <input
        name="assessmentQualityPartner"
        placeholder={t("eisa.aqp")}
        className={`${inputClass} block w-full`}
      />

      {state.error ? <p className="text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.notice ? <p className="text-sm text-[var(--muted)]">{state.notice}</p> : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {saving ? t("common.saving") : t("eisa.addSitting")}
      </button>
    </form>
  );
}
