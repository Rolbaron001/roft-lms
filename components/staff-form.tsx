"use client";

import { useActionState, useState } from "react";
import { assignStaffAction, removeStaffAction, type StaffState } from "@/app/staff-actions";
import { useDay, useT } from "@/components/i18n";
import { DateField } from "@/components/date-field";

type Capacity = "facilitator" | "assessor" | "moderator";
const CAPACITIES: Capacity[] = ["facilitator", "assessor", "moderator"];

/**
 * The people named on a programme, and the form to name more (job sheet D27).
 * Shown on a qualification, a study unit's course, a course and a programme.
 */
export function StaffForm({
  scope,
  path,
  rows,
  eligible,
  canManage,
}: {
  scope: { name: "qualificationId" | "studyUnitId" | "courseId" | "learningPathId"; id: string };
  path: string;
  rows: { id: string; name: string; capacity: Capacity; registrationNumber: string | null; registrationExpiresOn: string | null; inherited: boolean }[];
  eligible: Record<Capacity, { id: string; name: string }[]>;
  canManage: boolean;
}) {
  const t = useT();
  const { day } = useDay();
  const [state, assign, assigning] = useActionState<StaffState, FormData>(assignStaffAction, {});
  const [removed, remove] = useActionState<StaffState, FormData>(removeStaffAction, {});
  const [capacity, setCapacity] = useState<Capacity>("facilitator");
  const field = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

  return (
    <div className="space-y-4 text-sm">
      {CAPACITIES.map((one) => {
        const named = rows.filter((row) => row.capacity === one);
        return (
          <div key={one}>
            <p className="font-medium">{t(`staff.capacity.${one}`)}</p>
            {named.length === 0 ? (
              <p className="text-[var(--muted)]">{t("staff.none")}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {named.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2">
                    <span>{row.name}</span>
                    {row.registrationNumber ? (
                      <span className="text-xs text-[var(--muted)]">
                        {t("staff.registration", { number: row.registrationNumber })}
                        {row.registrationExpiresOn ? ` · ${t("staff.expires", { date: day(row.registrationExpiresOn) })}` : ""}
                      </span>
                    ) : null}
                    {row.inherited ? <span className="text-xs text-[var(--muted)]">{t("staff.inherited")}</span> : null}
                    {canManage && !row.inherited ? (
                      <form action={remove}>
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="path" value={path} />
                        <button type="submit" className="text-xs text-[var(--danger)] underline underline-offset-2">{t("staff.remove")}</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {canManage ? (
        <form action={assign} className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
          <input type="hidden" name={scope.name} value={scope.id} />
          <input type="hidden" name="path" value={path} />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--muted)]">{t("staff.as")}</span>
            <select name="capacity" value={capacity} onChange={(event) => setCapacity(event.target.value as Capacity)} className={field}>
              {CAPACITIES.map((one) => (
                <option key={one} value={one}>{t(`staff.one.${one}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--muted)]">{t("staff.person")}</span>
            <select name="userId" required className={field} key={capacity}>
              <option value="">{t("staff.choose")}</option>
              {eligible[capacity].map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
          </label>
          {capacity !== "facilitator" ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[var(--muted)]">{t("staff.registrationField")}</span>
                <input name="registrationNumber" className={field} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[var(--muted)]">{t("staff.expiresField")}</span>
                <DateField name="registrationExpiresOn" />
              </label>
            </>
          ) : null}
          <button type="submit" disabled={assigning} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
            {t("staff.add")}
          </button>
          {eligible[capacity].length === 0 ? <p className="basis-full text-xs text-[var(--muted)]">{t("staff.nobodyEligible")}</p> : null}
        </form>
      ) : null}
      {state.error || removed.error ? <p role="alert" className="text-[var(--danger)]">{state.error ?? removed.error}</p> : null}
    </div>
  );
}
