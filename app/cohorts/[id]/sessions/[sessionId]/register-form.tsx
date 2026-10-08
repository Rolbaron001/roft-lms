"use client";

import { useActionState } from "react";
import { importAttendanceAction, takeRegisterAction } from "@/app/cohorts/actions";
import type { AttendanceImportState, CohortActionState } from "@/app/cohorts/actions";
import type { RegisterLine } from "@/lib/scheduling";
import { useT } from "@/components/i18n";

const MARKS = ["present", "absent", "excused"] as const;

/**
 * The register, taken in one submit.
 *
 * Every learner is submitted together rather than only the ones touched. A
 * register is a statement about the whole room at one moment, and sending only
 * the changes would make "not yet marked" indistinguishable from "marked and
 * then cleared" - a distinction that matters when the register is the evidence
 * that a session happened at all.
 */
export function RegisterForm({
  cohortId,
  sessionId,
  lines,
}: {
  cohortId: string;
  sessionId: string;
  lines: RegisterLine[];
}) {
  const t = useT();
  const [state, action, pending] = useActionState<CohortActionState, FormData>(
    takeRegisterAction,
    {},
  );
  // A meeting's attendance export, read into the register for checking (D20).
  const [imported, importAct, importing] = useActionState<AttendanceImportState, FormData>(importAttendanceAction, {});
  const proposed = imported.marks;

  if (lines.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("register.nobody")}</p>;
  }

  return (
    <div className="space-y-4">
    <form action={importAct} className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <p className="text-sm font-medium">{t("register.importTitle")}</p>
      <p className="text-xs text-[var(--muted)]">{t("register.importNote")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input name="file" type="file" accept=".csv,.xlsx" required className="text-sm" />
        <button type="submit" disabled={importing} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium disabled:opacity-60">
          {importing ? t("register.importing") : t("register.import")}
        </button>
      </div>
      {imported.error ? <p role="alert" className="text-sm text-[var(--danger)]">{imported.error}</p> : null}
      {proposed ? (
        <div role="status" className="text-sm">
          <p className="text-[var(--success)]">
            {t("register.imported", { read: imported.read ?? 0, present: proposed.filter((mark) => mark.status === "present").length })}
            {imported.filed ? ` ${t("register.importFiled")}` : ""}
          </p>
          {imported.unknown && imported.unknown.length > 0 ? (
            <p className="text-[var(--muted)]">{t("register.importUnknown", { names: imported.unknown.join(", ") })}</p>
          ) : null}
        </div>
      ) : null}
    </form>
    <form action={action} className="space-y-4">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="sessionId" value={sessionId} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="pb-2">{t("register.learner")}</th>
              <th className="pb-2">{t("register.present")}</th>
              <th className="pb-2">{t("register.absent")}</th>
              <th className="pb-2">{t("register.excused")}</th>
              <th className="pb-2">{t("register.note")}</th>
            </tr>
          </thead>
          <tbody key={proposed ? `proposed-${imported.read}-${proposed.length}` : "saved"}>
            {lines.map((saved) => {
              const suggestion = proposed?.find((mark) => mark.userId === saved.userId);
              const line = suggestion ? { ...saved, status: suggestion.status, note: suggestion.note || saved.note } : saved;
              return (
              <tr key={line.userId} className="border-t border-[var(--border)]">
                <td className="py-2 pr-4">{line.name}</td>
                {MARKS.map((status) => (
                  <td key={status} className="py-2 pr-4">
                    <input
                      type="radio"
                      name={`mark:${line.userId}`}
                      value={status}
                      defaultChecked={line.status === status}
                      aria-label={t("register.markLabel", { name: line.name, mark: t(`register.${status}`) })}
                    />
                  </td>
                ))}
                <td className="py-2">
                  <input
                    name={`note:${line.userId}`}
                    defaultValue={line.note ?? ""}
                    placeholder={t("register.reasonHint")}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {state.error ? <p className="text-sm text-[var(--danger,#b00020)]">{state.error}</p> : null}
      {state.done ? <p className="text-sm text-[var(--muted)]">{state.done}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("common.saving") : t("register.save")}
      </button>

      <p className="text-xs text-[var(--muted)]">{t("register.excusedNote")}</p>
    </form>
    </div>
  );
}
