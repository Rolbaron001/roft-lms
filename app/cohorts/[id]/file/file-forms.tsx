"use client";

import { useActionState, useState } from "react";
import { useT } from "@/components/i18n";
import { fileCohortDocumentAction, removeCohortFileAction, type CohortActionState } from "../../actions";
import { COHORT_FILE_KINDS } from "@/lib/cohort-file-kinds";

const field = "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";

/**
 * Filing a document in the cohort's file (job sheet D20): what the platform
 * had nowhere else to keep. A facilitation plan or an attendance export
 * belongs to a class session; an assessor report or a feedback form to a
 * study unit.
 */
export function FileUpload({
  cohortId,
  sessions,
  units,
  initialKind = "facilitation_plan",
}: {
  cohortId: string;
  sessions: { id: string; label: string; kind: string }[];
  units: { id: string; code: string; title: string }[];
  initialKind?: string;
}) {
  const t = useT();
  const [state, act, pending] = useActionState<CohortActionState, FormData>(fileCohortDocumentAction, {});
  const [kind, setKind] = useState(initialKind);
  const bySession = kind === "facilitation_plan" || kind === "attendance_export";
  const byUnit = kind === "assessor_report" || kind === "programme_feedback";

  return (
    <form action={act} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="cohortId" value={cohortId} />
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">{t("cohortFile.kind")}</span>
        <select name="kind" value={kind} onChange={(event) => setKind(event.target.value)} className={field}>
          {COHORT_FILE_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`cohortFile.kind.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {bySession ? (
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("cohortFile.session")}</span>
          <select name="sessionId" className={field} defaultValue="">
            <option value="">{t("cohortFile.noSession")}</option>
            {sessions
              .filter((row) => kind !== "facilitation_plan" || row.kind === "lecture" || row.kind === "revision" || row.kind === "induction")
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
          </select>
        </label>
      ) : byUnit ? (
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("cohortFile.unit")}</span>
          <select name="studyUnitId" className={field} defaultValue="">
            <option value="">{t("cohortFile.noUnit")}</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.code} {unit.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span />
      )}
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          {t("cohortFile.title.field")} <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
        </span>
        <input name="title" className={field} placeholder={t("cohortFile.titleHint")} />
      </label>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">{t("cohortFile.file")}</span>
        <input name="file" type="file" required className="block w-full text-sm" />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--brand-primary)" }}>
          {pending ? t("cohortFile.filing") : t("cohortFile.fileIt")}
        </button>
        {state.done ? <p role="status" className="mt-2 text-sm text-[var(--success)]">{state.done}</p> : null}
        {state.error ? <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{state.error}</p> : null}
      </div>
    </form>
  );
}

export function RemoveFile({ cohortId, fileId, label }: { cohortId: string; fileId: string; label: string }) {
  const t = useT();
  const [, act, pending] = useActionState<CohortActionState, FormData>(removeCohortFileAction, {});
  return (
    <form
      action={act}
      onSubmit={(event) => {
        if (!window.confirm(t("cohortFile.confirmRemove", { file: label }))) event.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="fileId" value={fileId} />
      <button type="submit" disabled={pending} className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--danger)]">
        {t("cohortFile.remove")}
      </button>
    </form>
  );
}
