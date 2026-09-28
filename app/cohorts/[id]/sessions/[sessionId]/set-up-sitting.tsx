"use client";

import { useActionState, useState } from "react";
import {
  createSittingAction,
  setSittingStatusAction,
  type CohortActionState,
} from "@/app/cohorts/actions";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type SittingOption = { id: string; label: string };

/**
 * Setting up a supervised sitting on this session.
 *
 * Shown only where none exists. The defaults are the ones a provider almost
 * always wants - ten minutes early, admission closing five minutes after the
 * start, camera on - so the common case is choosing the paper and pressing the
 * button, and the rest is there for the sitting that needs it.
 *
 * The declaration is left empty rather than pre-filled with wording somebody
 * would have to notice and correct. A declaration a learner agrees to is the
 * provider's own statement about their own conduct rules, and a plausible
 * default that nobody read is worse than a blank one.
 */
export function SetUpSitting({
  cohortId,
  sessionId,
  assessments,
  invigilators,
}: {
  cohortId: string;
  sessionId: string;
  assessments: SittingOption[];
  invigilators: SittingOption[];
}) {
  const t = useT();
  const [state, action, saving] = useActionState<CohortActionState, FormData>(
    createSittingAction,
    {},
  );
  const [open, setOpen] = useState(false);

  if (assessments.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("sitting.needsAssessment")}</p>;
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">{t("sitting.nothing")}</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white"
        >
          {t("sitting.setUp")}
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="sessionId" value={sessionId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("sitting.which")}</span>
          <select name="assessmentId" required className={`${inputClass} mt-1 block w-full`}>
            <option value="">{t("sitting.choose")}</option>
            {assessments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("sitting.invigilator")}</span>
          <select name="invigilatorId" className={`${inputClass} mt-1 block w-full`}>
            <option value="">{t("sitting.nobodyYet")}</option>
            {invigilators.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("sitting.early")}</span>
          <input
            type="number"
            name="arriveBeforeMinutes"
            defaultValue={10}
            min={0}
            max={240}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("sitting.closesAfter")}</span>
          <input
            type="number"
            name="admissionClosesAfterMinutes"
            defaultValue={5}
            min={0}
            max={120}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="cameraRequired" defaultChecked />
        {t("sitting.camera")}
      </label>

      <label className="block text-sm">
        <span className="text-[var(--muted)]">{t("sitting.materials")}</span>
        <textarea
          name="permittedMaterials"
          rows={2}
          maxLength={2000}
          placeholder={t("sitting.materialsHint")}
          className={`${inputClass} mt-1 block w-full`}
        />
      </label>

      <label className="block text-sm">
        <span className="text-[var(--muted)]">{t("sitting.declaration")}</span>
        <textarea name="declarationText" rows={3} maxLength={4000} className={`${inputClass} mt-1 block w-full`} />
      </label>

      {state.error ? <p className="text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.done ? <p className="text-sm text-[var(--muted)]">{state.done}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? t("sitting.settingUp") : t("sitting.setItUp")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

const NEXT: Record<string, string[]> = {
  scheduled: ["open", "cancelled"],
  open: ["in_progress", "cancelled"],
  in_progress: ["closed"],
  closed: [],
  cancelled: [],
};

/**
 * Moving a sitting through its states.
 *
 * Only the moves that make sense from where it is, because the alternative -
 * five buttons, four of which are refused - teaches people to expect refusals
 * and stop reading them. A closed or cancelled sitting offers nothing, which is
 * the honest end of the sequence.
 *
 * This is not decoration: the admission cut-off is judged against the status,
 * so a sitting nobody opened admits nobody at all.
 */
export function SittingStatus({
  cohortId,
  sessionId,
  sittingId,
  status,
}: {
  cohortId: string;
  sessionId: string;
  sittingId: string;
  status: string;
}) {
  const t = useT();
  const [state, action, saving] = useActionState<CohortActionState, FormData>(
    setSittingStatusAction,
    {},
  );

  const moves = NEXT[status] ?? [];

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-3">
      <span className="text-sm">
        <span className="text-[var(--muted)]">{t("sitting.status")}</span>{" "}
        <span className="font-medium">{maybe(t, `sitting.status.${status}`) ?? status}</span>
      </span>

      {moves.map((move) => (
        <form key={move} action={action}>
          <input type="hidden" name="cohortId" value={cohortId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="sittingId" value={sittingId} />
          <input type="hidden" name="status" value={move} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border border-[var(--border)] px-3 py-1 text-xs transition hover:border-[var(--brand-accent)] disabled:opacity-60"
          >
            {maybe(t, `sitting.move.${move}`) ?? move}
          </button>
        </form>
      ))}

      {moves.length === 0 ? (
        <span className="text-xs text-[var(--muted)]">{t("sitting.nothingFurther")}</span>
      ) : null}

      {state.error ? <p className="w-full text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.done ? <p className="w-full text-sm text-[var(--muted)]">{state.done}</p> : null}
    </div>
  );
}
