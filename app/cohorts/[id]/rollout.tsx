"use client";
import { DateField } from "@/components/date-field";

import Link from "next/link";
import { useActionState, useState } from "react";
import { scheduleSessionAction } from "@/app/cohorts/actions";
import type { CohortActionState } from "@/app/cohorts/actions";
import type { ScheduledSession, SessionChoices } from "@/lib/scheduling";
import { ProviderClockNote } from "@/components/zoned-time";
import { useDay, useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const KINDS = [
  "induction",
  "lecture",
  "revision",
  "summative",
  "mock_eisa",
  "workplace_induction",
  "walk_in",
] as const;

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

/**
 * The roll-out: dated lectures, in the order they happen.
 *
 * It shows what each session covers, whether it has been held, and how far
 * through its register is, because the question a coordinator asks of a
 * schedule is rarely "what is on it" and almost always "what has not been done
 * yet".
 */
export function Rollout({
  cohortId,
  zone,
  sessions,
  canManage,
  canRegister,
  choices,
}: {
  cohortId: string;
  /** The provider's clock. Every time in the timetable is on it. */
  zone: string;
  sessions: ScheduledSession[];
  canManage: boolean;
  canRegister: boolean;
  /** The cohort's study units and workbooks, for the form (D17). */
  choices: SessionChoices;
}) {
  const t = useT();
  const { day } = useDay();
  const [kind, setKind] = useState<string>("lecture");
  const [unitId, setUnitId] = useState<string>(choices.units.length === 1 ? choices.units[0].id : "");
  const offered = choices.workbooks.filter((book) => !unitId || book.studyUnitId === unitId);
  const [state, action, pending] = useActionState<CohortActionState, FormData>(
    scheduleSessionAction,
    {},
  );

  return (
    <div className="space-y-6">
      {sessions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("rollout.nothing")}</p>
      ) : (
        <div>
          <ProviderClockNote zone={zone} />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2">#</th>
                  <th className="pb-2">{t("rollout.date")}</th>
                  <th className="pb-2">{t("rollout.session")}</th>
                  <th className="pb-2">{t("rollout.studyUnit")}</th>
                  <th className="pb-2">{t("rollout.workbooks")}</th>
                  <th className="pb-2">{t("rollout.register")}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((entry) => (
                  <tr key={entry.id} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-3 tabular-nums text-[var(--muted)]">{entry.sequence ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                      {day(entry.scheduledDate, { short: true })}
                      {entry.startTime ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {entry.startTime}
                          {entry.endTime ? `–${entry.endTime}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      {entry.title ?? maybe(t, `session.kind.${entry.kind}`) ?? entry.kind}
                      {entry.status !== "scheduled" ? (
                        <span className="ml-2 text-xs text-[var(--muted)]">
                          {maybe(t, `session.status.${entry.status}`) ?? entry.status}
                          {entry.statusNote ? `: ${entry.statusNote}` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted)]">
                      {entry.studyUnitCode ?? entry.moduleCode ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--muted)]">
                      {entry.workbooks.length === 0
                        ? "—"
                        : entry.workbooks
                            .map((w) => `${maybe(t, `session.role.${w.role}`) ?? w.role}: ${w.title}`)
                            .join(", ")}
                    </td>
                    <td className="py-2 tabular-nums">
                      {entry.status === "cancelled" ? (
                        <span className="text-[var(--muted)]">—</span>
                      ) : canRegister ? (
                        <Link href={`/cohorts/${cohortId}/sessions/${entry.id}`} className="hover:underline">
                          {entry.register.marked}/{entry.register.expected}
                        </Link>
                      ) : (
                        <span>
                          {entry.register.marked}/{entry.register.expected}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canManage ? (
        <form action={action} className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-3">
          <input type="hidden" name="cohortId" value={cohortId} />

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("rollout.date")}</span>
            <DateField name="scheduledDate" required className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("rollout.kind")}</span>
            <select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className={inputClass}>
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`session.kind.${value}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              {t("rollout.number")}{" "}
              <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
            </span>
            {kind === "lecture" ? (
              <input key={choices.nextLecture} name="sequence" type="number" min={1} defaultValue={choices.nextLecture} className={inputClass} />
            ) : (
              <input name="sequence" type="number" min={1} className={inputClass} />
            )}
            <span className="block text-xs text-[var(--muted)]">{t("rollout.numberNote")}</span>
          </label>

          {choices.units.length > 0 ? (
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">{t("rollout.studyUnit")}</span>
              <select name="studyUnitId" value={unitId} onChange={(event) => setUnitId(event.target.value)} className={inputClass}>
                <option value="">{t("rollout.noUnit")}</option>
                {choices.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.code} {unit.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {offered.length > 0 ? (
            <>
              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  {kind === "summative" || kind === "mock_eisa" ? t("rollout.sat") : t("rollout.handout")}{" "}
                  <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
                </span>
                <select name="handoutAssessmentId" defaultValue="" className={inputClass}>
                  <option value="">{t("rollout.none")}</option>
                  {offered
                    .filter((book) => (kind === "summative" || kind === "mock_eisa" ? book.summative : !book.summative))
                    .map((book) => (
                      <option key={book.assessmentId} value={book.assessmentId}>
                        {book.title}
                      </option>
                    ))}
                </select>
              </label>
              {kind === "summative" || kind === "mock_eisa" ? null : (
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium">
                    {t("rollout.handin")} <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
                  </span>
                  <select name="handinAssessmentId" defaultValue="" className={inputClass}>
                    <option value="">{t("rollout.none")}</option>
                    {offered
                      .filter((book) => !book.summative)
                      .map((book) => (
                        <option key={book.assessmentId} value={book.assessmentId}>
                          {book.title}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <p className="text-xs text-[var(--muted)] sm:col-span-3">{t("rollout.datesNote")}</p>
            </>
          ) : null}

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("rollout.starts")}</span>
            <input name="startTime" placeholder="18:30" className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("rollout.ends")}</span>
            <input name="endTime" placeholder="20:30" className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("rollout.delivery")}</span>
            <select name="deliveryMode" defaultValue="virtual" className={inputClass}>
              <option value="virtual">{t("rollout.virtual")}</option>
              <option value="in_person">{t("rollout.inPerson")}</option>
              <option value="blended">{t("rollout.blended")}</option>
            </select>
          </label>

          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">
              {t("rollout.link")}{" "}
              <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
            </span>
            <input name="meetingUrl" type="text" inputMode="url" placeholder={t("rollout.linkHint")} className={inputClass} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              {t("rollout.title")} <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
            </span>
            <input name="title" className={inputClass} />
          </label>

          <div className="sm:col-span-3">
            {state.error ? <p className="mb-2 text-sm text-[var(--danger,#b00020)]">{state.error}</p> : null}
            {state.done ? <p className="mb-2 text-sm text-[var(--muted)]">{state.done}</p> : null}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? t("rollout.adding") : t("rollout.add")}
            </button>
            <p className="mt-2 text-xs text-[var(--muted)]">{t("rollout.announced")}</p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
