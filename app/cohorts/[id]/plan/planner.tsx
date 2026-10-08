"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { useDay, useT } from "@/components/i18n";
import { Guide } from "@/components/ui";
import type { CohortPlan, PlanStep } from "@/lib/cohort-plan";
import { autoPlanAction, setStepDatesAction, setStepReleasedAction, type CohortActionState } from "../../actions";

const day = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The cohort planner (Roland's design of 7 October 2026): the plan week by
 * week under each study unit, every item clickable to change its dates or
 * release it, and beside it what learners see on any chosen day. A change
 * shows in the week it lands in as soon as it is saved.
 */
export function Planner({ plan, canManage }: { plan: CohortPlan; canManage: boolean }) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [viewDate, setViewDate] = useState(today < plan.cohort.startDate ? plan.cohort.startDate : today);
  const [planState, planAct, planning] = useActionState<CohortActionState, FormData>(autoPlanAction, {});

  const { day: writeDay } = useDay();
  const nice = (date: string) => writeDay(date, { short: true, weekday: true });
  const anyPlanned = plan.steps.some((step) => step.opens || step.due);

  // Weeks counted from the cohort's start, so each row is one teaching week.
  const lastDate = [...plan.steps.flatMap((step) => [step.opens, step.due]), ...plan.sessions.map((row) => row.date)].filter((date): date is string => Boolean(date)).sort().at(-1) ?? plan.cohort.startDate;
  const weekCount = Math.max(1, Math.floor((Date.parse(lastDate) - Date.parse(plan.cohort.startDate)) / (7 * 86_400_000)) + 1);
  const weeks = Array.from({ length: weekCount }, (_, index) => day(plan.cohort.startDate, index * 7));
  const inWeek = (date: string | null, week: string) => Boolean(date && date >= week && date < day(week, 7));

  const bands = useMemo(
    () =>
      plan.units.map((unit) => {
        const steps = plan.steps.filter((step) => step.unitCode === unit.code);
        const dates = steps.flatMap((step) => [step.opens, step.due]).filter((date): date is string => Boolean(date)).sort();
        const first = dates[0];
        const last = dates.at(-1);
        return { unit, steps, weeks: first && last ? weeks.filter((week) => day(week, 6) >= first && week <= last) : [] };
      }),
    [plan, weeks],
  );

  const notPlanned = plan.steps.filter((step) => !step.opens && !step.releasedAt);
  const noDue = plan.steps.filter((step) => step.category === "workbook" && step.opens && !step.due);

  const statusOn = (step: PlanStep, date: string): { text: string; tone: "open" | "due" | "past" | "locked" } => {
    const opensOn = step.releasedAt && (!step.opens || step.releasedAt < step.opens) ? step.releasedAt : step.opens;
    if (!opensOn || opensOn > date) return { text: opensOn ? t("planner.lockedUntil", { date: nice(opensOn) }) : t("planner.notPlanned"), tone: "locked" };
    if (step.due && step.due === date) return { text: t("planner.dueToday"), tone: "due" };
    if (step.due && step.due < date) return { text: t("planner.handedInBy", { date: nice(step.due) }), tone: "past" };
    if (opensOn === date) return { text: t("planner.opensToday"), tone: "open" };
    return { text: step.due ? t("planner.openDue", { date: nice(step.due) }) : t("planner.open"), tone: "open" };
  };

  return (
    <div className="space-y-5">
      {plan.cohort.releaseMode === "open" ? (
        <div className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-4 py-3 text-sm">{t("planner.openMode")}</div>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-start gap-2">
          <form
            action={planAct}
            onSubmit={(event) => {
              if (anyPlanned && !window.confirm(t("planner.replaceConfirm"))) event.preventDefault();
            }}
          >
            <input type="hidden" name="cohortId" value={plan.cohort.id} />
            <button type="submit" disabled={planning} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
              {planning ? t("planner.planning") : t("planner.planForMe")}
            </button>
          </form>
          {plan.cohort.releaseMode !== "open" ? (
            <Link href={`/cohorts/${plan.cohort.id}#rollout`} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm">
              {t("planner.fromSpreadsheet")}
            </Link>
          ) : null}
          <Link href={`/cohorts/${plan.cohort.id}#move`} className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 text-sm">
            {t("planner.moveStart")}
          </Link>
          {planState.done ? <p className="w-full text-sm text-[var(--success)]">{planState.done}</p> : null}
          {planState.error ? <p role="alert" className="w-full text-sm text-[var(--danger)]">{planState.error}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[999_1_640px] space-y-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("planner.byWeek")}</h2>
            <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2f7d57]" />{t("planner.legendOpens")}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#b7791f]" />{t("planner.legendDue")}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#7a3d68]" />{t("planner.legendSummative")}</span>
            </div>
          </div>

          <Guide label={t("guide.how")} points={[t("planner.guideWeeks.1"), t("planner.guideWeeks.2"), t("planner.guideWeeks.3"), t("planner.guideWeeks.4")]} />

          {!anyPlanned ? <p className="text-sm text-[var(--muted)]">{t("planner.empty")}</p> : null}

          {bands.map(({ unit, steps, weeks: unitWeeks }) => (
            <div key={unit.code || unit.title} className="flex gap-3">
              <div className="w-1.5 shrink-0 rounded-full bg-[var(--brand-accent)]" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {unit.code} {unit.title}
                </p>
                {steps.filter((step) => step.releasedAt && !step.opens).map((step) => (
                  <p key={step.id} className="text-xs text-[var(--muted)]">{t("planner.releasedByHand", { item: step.label, date: nice(step.releasedAt!) })}</p>
                ))}
                {unitWeeks.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">{t("planner.unitNotPlanned")}</p> : null}
                {unitWeeks.map((week) => {
                  const lecture = plan.sessions.find((row) => inWeek(row.date, week));
                  const events = steps.flatMap((step) => {
                    const list: { step: PlanStep; kind: "opens" | "due" | "summative" }[] = [];
                    if (step.category === "summative" && inWeek(step.opens, week)) list.push({ step, kind: "summative" });
                    else {
                      if (inWeek(step.opens, week)) list.push({ step, kind: "opens" });
                      if (step.category !== "summative" && inWeek(step.due, week)) list.push({ step, kind: "due" });
                    }
                    return list;
                  });
                  const editing = events.find((event) => event.step.id === selected)?.step ?? null;
                  const viewing = viewDate >= week && viewDate < day(week, 7);
                  return (
                    <div
                      key={week}
                      className={`grid grid-cols-[8rem_minmax(0,1fr)] gap-3 rounded-lg px-3 py-2.5 ${viewing ? "border-2 border-[var(--brand-accent)] bg-[var(--brand-accent)]/5" : "border border-[var(--border)]"}`}
                    >
                      <button type="button" onClick={() => setViewDate(lecture?.date ?? week)} className="text-left">
                        <span className="block font-semibold">{nice(lecture?.date ?? week)}</span>
                        <span className="block text-xs text-[var(--muted)]">
                          {lecture ? `${lecture.title ?? t("planner.lecture")}${lecture.startTime ? ` · ${lecture.startTime}` : ""}` : t("planner.noLecture")}
                        </span>
                      </button>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {events.length === 0 ? <span className="text-xs text-[var(--muted)]">{t("planner.nothingThisWeek")}</span> : null}
                          {events.map(({ step, kind }) => (
                            <button
                              key={`${step.id}-${kind}`}
                              type="button"
                              disabled={!canManage}
                              onClick={() => setSelected(selected === step.id ? null : step.id)}
                              className={`rounded-full px-2.5 py-1 text-xs ${
                                kind === "opens" ? "bg-[#e3f1ea] text-[#1f5c3f]" : kind === "due" ? "bg-[#fbefd9] text-[#7a4f10]" : "bg-[#efe2ec] text-[#5d2b50]"
                              } ${selected === step.id ? "ring-2 ring-[var(--brand-primary)]" : ""}`}
                            >
                              {kind === "opens"
                                ? t("planner.chipOpens", { item: step.label })
                                : kind === "due"
                                  ? t("planner.chipDue", { item: step.label })
                                  : t("planner.chipSummative", { item: step.label, opens: nice(step.opens!), due: step.due ? nice(step.due) : "" })}
                            </button>
                          ))}
                        </div>
                        {editing ? <StepEditor key={editing.id} cohortId={plan.cohort.id} step={editing} onDone={() => setSelected(null)} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <aside className="min-w-0 flex-[1_1_340px] space-y-4">
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="space-y-2 px-4 py-3 text-white" style={{ background: "var(--brand-primary)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-85">{t("planner.learnersSee")}</p>
              <div className="flex items-center justify-between gap-2">
                <button type="button" aria-label={t("planner.previousWeek")} onClick={() => setViewDate(day(viewDate, -7))} className="h-10 w-10 rounded-md border border-white/40">‹</button>
                <input
                  type="date"
                  value={viewDate}
                  onChange={(event) => event.target.value && setViewDate(event.target.value)}
                  aria-label={t("planner.chooseDay")}
                  className="rounded-md bg-white/10 px-2 py-1.5 text-base font-semibold text-white [color-scheme:dark]"
                />
                <button type="button" aria-label={t("planner.nextWeek")} onClick={() => setViewDate(day(viewDate, 7))} className="h-10 w-10 rounded-md border border-white/40">›</button>
              </div>
            </div>
            <div className="space-y-4 p-4 text-sm">
              <Guide label={t("guide.how")} points={[t("planner.guideSee.1"), t("planner.guideSee.2")]} />
              {bands.map(({ unit, steps }) => {
                const started = steps.some((step) => {
                  const opensOn = step.releasedAt ?? step.opens;
                  return opensOn && opensOn <= viewDate;
                });
                return (
                  <div key={unit.code || unit.title} className="space-y-1.5">
                    <p className="font-semibold">{unit.code} {unit.title}</p>
                    {started || plan.cohort.releaseMode === "open" ? (
                      steps.map((step) => {
                        const status = plan.cohort.releaseMode === "open" ? { text: t("planner.open"), tone: "open" as const } : statusOn(step, viewDate);
                        return (
                          <div key={step.id} className="flex justify-between gap-3">
                            <span className={status.tone === "locked" ? "text-[var(--muted)]" : ""}>{step.label}</span>
                            <span className={status.tone === "open" ? "text-[var(--success)]" : status.tone === "due" ? "text-[#7a4f10]" : "text-[var(--muted)]"}>{status.text}</span>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-[var(--muted)]">{t("planner.introOnly")}</p>
                    )}
                  </div>
                );
              })}
              {plan.cohort.qualificationId ? (
                <Link href={`/qualifications/${plan.cohort.qualificationId}/learner`} className="inline-block underline underline-offset-2">
                  {t("planner.openLearnerView")}
                </Link>
              ) : null}
            </div>
          </section>

          {notPlanned.length > 0 || noDue.length > 0 ? (
            <section className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
              <p className="font-semibold">{t("planner.notPlannedTitle")}</p>
              {notPlanned.map((step) => (
                <p key={step.id} className="text-[var(--muted)]">
                  {step.unitCode} {step.label}: {step.resit ? t("planner.resit") : t("planner.waitsForRelease")}
                </p>
              ))}
              {noDue.map((step) => (
                <p key={step.id} className="text-[#7a4f10]">{t("planner.noDue", { item: `${step.unitCode} ${step.label}` })}</p>
              ))}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** One item's dates, and its hand release, edited where it sits in the plan. */
function StepEditor({ cohortId, step, onDone }: { cohortId: string; step: PlanStep; onDone: () => void }) {
  const t = useT();
  const [state, act, pending] = useActionState<CohortActionState, FormData>(setStepDatesAction, {});
  const [, release, releasing] = useActionState<CohortActionState, FormData>(setStepReleasedAction, {});
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
      <p className="text-sm font-medium">{step.title}</p>
      <form action={act} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="cohortId" value={cohortId} />
        <input type="hidden" name="stepId" value={step.id} />
        <label className="flex flex-col gap-1 text-xs">
          {t("planner.opensOn")}
          <input name="opens" type="date" defaultValue={step.opens ?? ""} className="h-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm" />
        </label>
        {step.category === "workbook" || step.category === "summative" ? (
          <label className="flex flex-col gap-1 text-xs">
            {step.category === "summative" ? t("planner.closesOn") : t("planner.dueOn")}
            <input name="due" type="date" defaultValue={step.due ?? ""} className="h-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm" />
          </label>
        ) : null}
        <button type="submit" disabled={pending} className="h-10 rounded-md px-3 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
          {t("planner.save")}
        </button>
        <button type="button" onClick={onDone} className="h-10 rounded-md border border-[var(--border)] px-3 text-sm">
          {t("planner.close")}
        </button>
      </form>
      <form action={release}>
        <input type="hidden" name="cohortId" value={cohortId} />
        <input type="hidden" name="stepId" value={step.id} />
        <input type="hidden" name="released" value={step.releasedAt ? "no" : "yes"} />
        <button type="submit" disabled={releasing} className="text-xs underline underline-offset-2 disabled:opacity-60">
          {step.releasedAt ? t("cohortCtl.takeBack") : t("cohortCtl.releaseNow")}
        </button>
      </form>
      {state.error ? <p role="alert" className="text-xs text-[var(--danger)]">{state.error}</p> : null}
      {state.done ? <p className="text-xs text-[var(--success)]">{state.done}</p> : null}
    </div>
  );
}
