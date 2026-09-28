"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  lodgeAppealAction,
  type AppealActionState,
} from "@/app/appeals/actions";
import { ZonedTime } from "@/components/zoned-time";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Lodging an appeal, and what has been lodged before.
 *
 * On the learner's own page rather than behind the appeals list, because it is
 * always raised about a particular person and whoever is taking it down is
 * usually already looking at them.
 */
export function Appeals({
  learnerId,
  zone,
  cohorts,
  assessments,
  existing,
  canManage,
}: {
  learnerId: string;
  zone: string;
  cohorts: { id: string; name: string }[];
  assessments: { id: string; title: string }[];
  existing: {
    id: string;
    ground: string;
    cohortName: string;
    lodgedAt: Date;
    status: string;
    outcome: string | null;
  }[];
  canManage: boolean;
}) {
  const t = useT();
  const [state, action, saving] = useActionState<AppealActionState, FormData>(
    lodgeAppealAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const ground = (value: string) => maybe(t, `appeals.ground.${value}`) ?? value;

  return (
    <div className="space-y-4">
      {existing.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {existing.map((appeal) => (
            <li key={appeal.id} className="flex flex-wrap items-baseline gap-x-3">
              {canManage ? (
                <Link href={`/appeals/${appeal.id}`} className="font-medium hover:underline">
                  {ground(appeal.ground)}
                </Link>
              ) : (
                <span className="font-medium">{ground(appeal.ground)}</span>
              )}
              <span className="text-[var(--muted)]">
                {appeal.cohortName} ·{" "}
                <ZonedTime at={appeal.lodgedAt} zone={zone} withDate showViewer={false} />
              </span>
              <span>
                {maybe(t, `appeals.status.${appeal.status}`) ?? appeal.status}
                {appeal.outcome
                  ? `: ${maybe(t, `appeals.outcome.${appeal.outcome}`) ?? appeal.outcome.replace(/_/g, " ")}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t("lodge.none")}</p>
      )}

      {cohorts.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">{t("lodge.noCohort")}</p>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          {t("lodge.start")}
        </button>
      ) : (
        <LodgeForm
          key={state.attempt ?? 0}
          learnerId={learnerId}
          cohorts={cohorts}
          assessments={assessments}
          action={action}
          state={state}
          saving={saving}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The form itself, re-mounted on every refusal.
 *
 * Keyed by the attempt so that the defaults below are re-read. Without that,
 * `defaultValue` is only honoured on the first mount and the form empties
 * itself the moment a rule refuses - which is exactly when somebody has typed
 * the most.
 */
function LodgeForm({
  learnerId,
  cohorts,
  assessments,
  action,
  state,
  saving,
  onCancel,
}: {
  learnerId: string;
  cohorts: { id: string; name: string }[];
  assessments: { id: string; title: string }[];
  action: (formData: FormData) => void;
  state: AppealActionState;
  saving: boolean;
  onCancel: () => void;
}) {
  const t = useT();
  const kept = state.values ?? {};
  const [ground, setGround] = useState(kept.ground || "result");

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="learnerId" value={learnerId} />

      <div className="flex flex-wrap gap-2">
        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">{t("lodge.cohort")}</span>
          <select name="cohortId" defaultValue={kept.cohortId} className={inputClass} required>
            {cohorts.map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">{t("lodge.ground")}</span>
          <select
            name="ground"
            value={ground}
            onChange={(event) => setGround(event.target.value)}
            className={inputClass}
          >
            <option value="result">{t("appeals.ground.result")}</option>
            <option value="assessor_conduct">{t("appeals.ground.assessor_conduct")}</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">
            {ground === "result" ? t("lodge.resultsReceived") : t("lodge.incident")}
          </span>
          <input
            type="date"
            name="triggeredOn"
            defaultValue={kept.triggeredOn}
            required
            className={inputClass}
          />
        </label>
      </div>

      {ground === "result" ? (
        <label className="block text-sm">
          <span className="mr-2 text-[var(--muted)]">{t("lodge.assessment")}</span>
          <select name="assessmentId" defaultValue={kept.assessmentId} className={inputClass} required>
            <option value="">{t("lodge.chooseOne")}</option>
            {assessments.map((assessment) => (
              <option key={assessment.id} value={assessment.id}>
                {assessment.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <textarea
        name="statement"
        rows={4}
        required
        defaultValue={kept.statement}
        placeholder={t("lodge.statementHint")}
        className={`${inputClass} block w-full`}
      />

      {state.needsLateReason ? (
        <div className="rounded-md border border-[var(--border)] p-3">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">{t("lodge.lateWhy")}</span>
            <textarea
              name="lateAcceptanceReason"
              rows={2}
              defaultValue={kept.lateAcceptanceReason}
              className={`${inputClass} mt-1 block w-full`}
            />
          </label>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("lodge.lateNote")}</p>
        </div>
      ) : null}

      {state.error ? <p className="text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.notice ? <p className="text-sm text-[var(--muted)]">{state.notice}</p> : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? t("lodge.lodging") : t("lodge.lodge")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
