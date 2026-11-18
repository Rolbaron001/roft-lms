"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { DateField } from "@/components/date-field";
import { useT } from "@/components/i18n";
import { READINESS_DIMENSIONS, RECOMMENDATIONS } from "@/lib/coach-shape";
import { checklistAction, messageAction, readinessAction, witnessAction, type CoachState } from "./coach-actions";

const field = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const button =
  "rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60";

function Said({ state }: { state: CoachState }) {
  if (state.error) return <p className="text-sm" style={{ color: "var(--danger)" }}>{state.error}</p>;
  if (state.notice) return <p className="text-sm" style={{ color: "var(--success)" }}>{state.notice}</p>;
  return null;
}

/** Clears a form once it has been saved. */
function useResetOnNotice(state: CoachState) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.notice) form.current?.reset();
  }, [state.notice]);
  return form;
}

type Activities = { logbookId: string; module: string; items: string[] }[];

const TABS = ["checklist", "witness", "readiness", "message"] as const;
const RATINGS = [1, 2, 3, 4] as const;

/** What a workplace coach records about a learner (job sheet D52 (8) to (10)). */
export function CoachForms({ learnerId, today, activities }: { learnerId: string; today: string; activities: Activities }) {
  const t = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]>("checklist");
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((one) => (
          <button
            key={one}
            type="button"
            onClick={() => setTab(one)}
            className={`rounded-md border px-3 py-1.5 text-sm ${tab === one ? "border-[var(--brand-primary)] font-semibold" : "border-[var(--border)]"}`}
          >
            {t(`coach.tab.${one}`)}
          </button>
        ))}
      </div>
      {tab === "checklist" ? <Checklist learnerId={learnerId} today={today} activities={activities} /> : null}
      {tab === "witness" ? <Witness learnerId={learnerId} today={today} activities={activities} /> : null}
      {tab === "readiness" ? <Readiness learnerId={learnerId} /> : null}
      {tab === "message" ? <Message learnerId={learnerId} /> : null}
    </div>
  );
}

function Checklist({ learnerId, today, activities }: { learnerId: string; today: string; activities: Activities }) {
  const t = useT();
  const [state, action, pending] = useActionState<CoachState, FormData>(checklistAction, {});
  const form = useResetOnNotice(state);
  const [chosen, setChosen] = useState(activities[0]?.logbookId ?? "");
  const book = activities.find((one) => one.logbookId === chosen);
  // Drafted from the logbook's own work activities; the coach can add more.
  const [extra, setExtra] = useState(0);
  const items = [...(book?.items ?? []), ...Array.from({ length: extra }, () => "")];

  return (
    <form ref={form} action={action} className="max-w-3xl space-y-3">
      <input type="hidden" name="learnerId" value={learnerId} />
      <input type="hidden" name="count" value={items.length} />
      <p className="text-sm text-[var(--muted)]">{t("coach.checklist.intro")}</p>
      <div className="flex flex-wrap gap-2">
        {activities.length > 0 ? (
          <select name="logbookId" value={chosen} onChange={(event) => setChosen(event.target.value)} className={field}>
            {activities.map((one) => (
              <option key={one.logbookId} value={one.logbookId}>{one.module}</option>
            ))}
          </select>
        ) : null}
        <input name="title" placeholder={t("coach.checklist.title")} className={`${field} min-w-64 flex-1`} />
        <DateField name="observedOn" defaultValue={today} />
      </div>
      {items.length === 0 ? <p className="text-sm text-[var(--muted)]">{t("coach.checklist.empty")}</p> : null}
      <ul className="space-y-2">
        {items.map((label, index) => (
          <li key={`${chosen}-${index}`} className="rounded-md border border-[var(--border)] p-2">
            <div className="flex items-start gap-2">
              <input type="checkbox" name={`observed_${index}`} value="yes" className="mt-1.5" aria-label={t("coach.checklist.observed")} />
              {label ? (
                <>
                  <input type="hidden" name={`label_${index}`} value={label} />
                  <span className="text-sm">{label}</span>
                </>
              ) : (
                <input name={`label_${index}`} placeholder={t("coach.checklist.item")} className={`${field} flex-1`} />
              )}
            </div>
            <input name={`comment_${index}`} placeholder={t("coach.comment")} className={`${field} mt-2 w-full`} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setExtra(extra + 1)} className="text-sm underline-offset-2 hover:underline">
        {t("coach.checklist.add")}
      </button>
      <p className="text-xs text-[var(--muted)]">{t("coach.signNote")}</p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>{pending ? t("common.saving") : t("coach.sign")}</button>
        <Said state={state} />
      </div>
    </form>
  );
}

function Witness({ learnerId, today, activities }: { learnerId: string; today: string; activities: Activities }) {
  const t = useT();
  const [state, action, pending] = useActionState<CoachState, FormData>(witnessAction, {});
  const form = useResetOnNotice(state);
  return (
    <form ref={form} action={action} className="max-w-2xl space-y-3">
      <input type="hidden" name="learnerId" value={learnerId} />
      <p className="text-sm text-[var(--muted)]">{t("coach.witness.intro")}</p>
      <div className="flex flex-wrap gap-2">
        <input name="witnessName" required placeholder={t("coach.witness.name")} className={`${field} flex-1`} />
        <input name="witnessRole" placeholder={t("coach.witness.role")} className={`${field} flex-1`} />
        <DateField name="observedOn" defaultValue={today} />
      </div>
      {activities.length > 0 ? (
        <select name="logbookId" className={field} defaultValue="">
          <option value="">{t("coach.witness.anyModule")}</option>
          {activities.map((one) => (
            <option key={one.logbookId} value={one.logbookId}>{one.module}</option>
          ))}
        </select>
      ) : null}
      <textarea name="statement" required rows={5} placeholder={t("coach.witness.statement")} className={`${field} w-full`} />
      <p className="text-xs text-[var(--muted)]">{t("coach.signNote")}</p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>{pending ? t("common.saving") : t("coach.sign")}</button>
        <Said state={state} />
      </div>
    </form>
  );
}

function Readiness({ learnerId }: { learnerId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<CoachState, FormData>(readinessAction, {});
  const form = useResetOnNotice(state);
  return (
    <form ref={form} action={action} className="max-w-2xl space-y-3">
      <input type="hidden" name="learnerId" value={learnerId} />
      <p className="text-sm text-[var(--muted)]">{t("coach.readiness.intro")}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-[var(--muted)]">
          <tr>
            <th className="py-1 font-medium" />
            {RATINGS.map((value) => (
              <th key={value} className="px-2 py-1 text-center font-medium">{t(`coach.rating.${value}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {READINESS_DIMENSIONS.map((dimension) => (
            <tr key={dimension} className="border-t border-[var(--border)]">
              <td className="py-2">{t(`coach.dimension.${dimension}`)}</td>
              {RATINGS.map((value) => (
                <td key={value} className="text-center">
                  <input type="radio" name={dimension} value={value} required aria-label={`${t(`coach.dimension.${dimension}`)}: ${t(`coach.rating.${value}`)}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-sm font-medium">{t("coach.readiness.overall")}</legend>
        {RECOMMENDATIONS.map((one) => (
          <label key={one} className="flex items-center gap-1.5">
            <input type="radio" name="recommendation" value={one} required />
            {t(`coach.recommendation.${one}`)}
          </label>
        ))}
      </fieldset>
      <textarea name="comments" rows={4} placeholder={t("coach.comment")} className={`${field} w-full`} />
      <p className="text-xs text-[var(--muted)]">{t("coach.signNote")}</p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>{pending ? t("common.saving") : t("coach.sign")}</button>
        <Said state={state} />
      </div>
    </form>
  );
}

function Message({ learnerId }: { learnerId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<CoachState, FormData>(messageAction, {});
  const form = useResetOnNotice(state);
  return (
    <form ref={form} action={action} className="max-w-2xl space-y-3">
      <input type="hidden" name="learnerId" value={learnerId} />
      <p className="text-sm text-[var(--muted)]">{t("coach.message.intro")}</p>
      <textarea name="body" required rows={5} className={`${field} w-full`} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>{pending ? t("coach.message.sending") : t("coach.message.send")}</button>
        <Said state={state} />
      </div>
    </form>
  );
}
