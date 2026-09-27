"use client";

import { useActionState } from "react";
import { recordTransferAction, type RecognitionState } from "./actions";
import { useT } from "@/components/i18n";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Recording a credit transfer.
 *
 * The module is given as an identifier rather than chosen from a list, because
 * which modules are available depends on the learner's qualification and this
 * form is reached before one has been picked. The library refuses an identifier
 * that is not a module of theirs, so a wrong one is caught rather than stored.
 *
 * The mapping paragraph is the decision. Everything else on this form is
 * provenance; the mapping is the reasoning, and the library refuses a transfer
 * without it.
 */
export function RecordTransfer({
  learners,
}: {
  learners: { id: string; label: string }[];
}) {
  const t = useT();
  const [state, action, saving] = useActionState<RecognitionState, FormData>(
    recordTransferAction,
    {},
  );
  const kept = state.values ?? {};

  if (learners.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{t("rpl.needsLearner")}</p>;
  }

  return (
    <form key={state.attempt ?? 0} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.learner")}</span>
          <select
            name="learnerId"
            required
            defaultValue={kept.learnerId}
            className={`${inputClass} mt-1 block w-full`}
          >
            <option value="">{t("rpl.choose")}</option>
            {learners.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.module")}</span>
          <input
            name="curriculumModuleId"
            required
            placeholder={t("rpl.moduleId")}
            defaultValue={kept.curriculumModuleId}
            className={`${inputClass} mt-1 block w-full font-mono`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.holds")}</span>
          <input
            name="sourceQualification"
            required
            minLength={3}
            defaultValue={kept.sourceQualification}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.awardedBy")}</span>
          <input
            name="sourceProvider"
            defaultValue={kept.sourceProvider}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.saqaId")}</span>
          <input
            name="sourceSaqaId"
            defaultValue={kept.sourceSaqaId}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.credits")}</span>
          <input
            name="sourceCredits"
            type="number"
            min={0}
            defaultValue={kept.sourceCredits}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.awardedOn")}</span>
          <input
            type="date"
            name="awardedOn"
            defaultValue={kept.awardedOn}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("rpl.approvedOn")}</span>
          <input
            type="date"
            name="approvedOn"
            required
            defaultValue={kept.approvedOn}
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-[var(--muted)]">{t("rpl.mapping")}</span>
        <textarea
          name="mapping"
          required
          minLength={30}
          rows={3}
          defaultValue={kept.mapping}
          className={`${inputClass} mt-1 block w-full`}
        />
      </label>

      {state.error ? <p className="text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.notice ? <p className="text-sm text-[var(--muted)]">{state.notice}</p> : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {saving ? t("assessing.recording") : t("rpl.recordTransfer")}
      </button>
    </form>
  );
}
