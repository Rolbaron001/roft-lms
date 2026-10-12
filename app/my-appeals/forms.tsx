"use client";

import { useActionState, useState } from "react";
import { lodgeAppealAction, type AppealActionState } from "@/app/appeals/actions";
import { lodgeGrievanceAction, type ConductActionState } from "@/app/conduct/actions";
import { DateField } from "@/components/date-field";
import { useDay, useT } from "@/components/i18n";

/**
 * A learner's own appeal and concern forms (Roland, 12 October 2026). They
 * lodge in the learner's own name: no learner is chosen here, and the
 * platform refuses one learner lodging for another (lib/appeals.ts).
 */

const field = "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
const label = "block text-sm font-medium";
const button = "rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

type Result = { assessmentId: string; title: string; outcome: string; decidedOn: string; cohortId: string | null };
type Cohort = { id: string; name: string };

function Messages({ state }: { state: { error?: string; notice?: string } }) {
  if (state.error) return <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p>;
  if (state.notice) return <p role="status" className="text-sm text-[var(--success,#166534)]">{state.notice}</p>;
  return null;
}

function CohortChoice({ cohorts, value, onChange }: { cohorts: Cohort[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  if (cohorts.length === 1) return <input type="hidden" name="cohortId" value={cohorts[0].id} />;
  return (
    <label className="block space-y-1">
      <span className={label}>{t("myAppeals.cohort")}</span>
      <select name="cohortId" required value={value} onChange={(event) => onChange(event.target.value)} className={field}>
        <option value="">{t("myAppeals.choose")}</option>
        {cohorts.map((cohort) => (
          <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
        ))}
      </select>
    </label>
  );
}

export function AppealResultForm({ results, cohorts, preselect }: { results: Result[]; cohorts: Cohort[]; preselect: string | null }) {
  const t = useT();
  const { day } = useDay();
  const [state, action, saving] = useActionState<AppealActionState, FormData>(lodgeAppealAction, {});
  const initial = results.find((result) => result.assessmentId === preselect) ?? null;
  const [chosen, setChosen] = useState<string>(initial?.assessmentId ?? "");
  const [received, setReceived] = useState<string>(initial?.decidedOn ?? "");
  const [cohort, setCohort] = useState<string>(initial?.cohortId ?? (cohorts.length === 1 ? cohorts[0].id : ""));

  const choose = (id: string) => {
    setChosen(id);
    const result = results.find((one) => one.assessmentId === id);
    if (result) {
      setReceived(result.decidedOn);
      if (result.cohortId) setCohort(result.cohortId);
    }
  };

  if (state.notice) return <Messages state={state} />;

  return (
    <form action={action} key={state.attempt ?? 0} className="space-y-3">
      <input type="hidden" name="ground" value="result" />
      <label className="block space-y-1">
        <span className={label}>{t("myAppeals.whichResult")}</span>
        <select name="assessmentId" required value={chosen} onChange={(event) => choose(event.target.value)} className={field}>
          <option value="">{t("myAppeals.choose")}</option>
          {results.map((result) => (
            <option key={result.assessmentId} value={result.assessmentId}>
              {t("myAppeals.resultOption", {
                title: result.title,
                outcome: t(`common.${result.outcome === "competent" ? "competent" : "notYetCompetent"}`),
                date: day(result.decidedOn),
              })}
            </option>
          ))}
        </select>
      </label>
      <CohortChoice cohorts={cohorts} value={cohort} onChange={setCohort} />
      <div className="space-y-1">
        <span className={label}>{t("myAppeals.received")}</span>
        <DateField name="triggeredOn" value={received} onChange={setReceived} required />
        <p className="text-xs text-[var(--muted)]">{t("myAppeals.receivedHint")}</p>
      </div>
      <label className="block space-y-1">
        <span className={label}>{t("myAppeals.why")}</span>
        <textarea name="statement" required minLength={20} rows={5} defaultValue={state.values?.statement ?? ""} className={field} />
        <span className="block text-xs text-[var(--muted)]">{t("myAppeals.whyHint")}</span>
      </label>
      {state.needsLateReason ? (
        <label className="block space-y-1">
          <span className={label}>{t("myAppeals.late")}</span>
          <textarea name="lateAcceptanceReason" required rows={2} defaultValue={state.values?.lateAcceptanceReason ?? ""} className={field} />
        </label>
      ) : null}
      <Messages state={state} />
      <button type="submit" disabled={saving} className={button} style={{ background: "var(--brand-primary)" }}>
        {saving ? t("myAppeals.lodging") : t("myAppeals.lodgeAppeal")}
      </button>
    </form>
  );
}

export function AppealConductForm({ cohorts }: { cohorts: Cohort[] }) {
  const t = useT();
  const [state, action, saving] = useActionState<AppealActionState, FormData>(lodgeAppealAction, {});
  const [cohort, setCohort] = useState<string>(cohorts.length === 1 ? cohorts[0].id : "");

  if (state.notice) return <Messages state={state} />;

  return (
    <form action={action} key={state.attempt ?? 0} className="space-y-3">
      <input type="hidden" name="ground" value="assessor_conduct" />
      <CohortChoice cohorts={cohorts} value={cohort} onChange={setCohort} />
      <div className="space-y-1">
        <span className={label}>{t("myAppeals.when")}</span>
        <DateField name="triggeredOn" defaultValue={state.values?.triggeredOn ?? ""} required />
      </div>
      <label className="block space-y-1">
        <span className={label}>{t("myAppeals.whatHappened")}</span>
        <textarea name="statement" required minLength={20} rows={5} defaultValue={state.values?.statement ?? ""} className={field} />
        <span className="block text-xs text-[var(--muted)]">{t("myAppeals.whatHappenedHint")}</span>
      </label>
      {state.needsLateReason ? (
        <label className="block space-y-1">
          <span className={label}>{t("myAppeals.late")}</span>
          <textarea name="lateAcceptanceReason" required rows={2} defaultValue={state.values?.lateAcceptanceReason ?? ""} className={field} />
        </label>
      ) : null}
      <Messages state={state} />
      <button type="submit" disabled={saving} className={button} style={{ background: "var(--brand-primary)" }}>
        {saving ? t("myAppeals.lodging") : t("myAppeals.lodgeAppeal")}
      </button>
    </form>
  );
}

export function ConcernForm() {
  const t = useT();
  const [state, action, saving] = useActionState<ConductActionState, FormData>(lodgeGrievanceAction, {});

  if (state.notice) return <Messages state={state} />;

  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1">
        <span className={label}>{t("myAppeals.concern")}</span>
        <textarea name="nature" required minLength={20} rows={5} defaultValue={state.values?.nature ?? ""} className={field} />
        <span className="block text-xs text-[var(--muted)]">{t("myAppeals.concernHint")}</span>
      </label>
      <label className="block space-y-1">
        <span className={label}>{t("myAppeals.who")} <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span></span>
        <input name="individualsInvolved" defaultValue={state.values?.individualsInvolved ?? ""} className={field} />
      </label>
      <div className="space-y-1">
        <span className={label}>{t("myAppeals.whenConcern")} <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span></span>
        <DateField name="occurredOn" defaultValue={state.values?.occurredOn ?? ""} />
      </div>
      <label className="block space-y-1">
        <span className={label}>{t("myAppeals.outcome")} <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span></span>
        <textarea name="desiredOutcome" rows={2} defaultValue={state.values?.desiredOutcome ?? ""} className={field} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="informalAttempted" />
        {t("myAppeals.informal")}
      </label>
      <Messages state={state} />
      <button type="submit" disabled={saving} className={button} style={{ background: "var(--brand-primary)" }}>
        {saving ? t("myAppeals.lodging") : t("myAppeals.raise")}
      </button>
    </form>
  );
}
