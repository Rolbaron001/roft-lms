"use client";

import { useActionState, useState } from "react";
import {
  fileDocumentAction,
  recordDisposalAction,
  type RecordsActionState,
} from "./actions";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

export const CATEGORY_LABEL: Record<string, string> = {
  policy: "Policies and procedures",
  accreditation: "Accreditation",
  contract: "Contracts",
  statutory: "Statutory",
  operational: "Operational",
  learner_guide: "Learner guides",
  other: "Other",
};

/**
 * Filing a business document.
 *
 * The supersedes field is the one worth the space. Naming what this replaces
 * marks the old one superseded in the same act, so there is never a moment
 * where two documents both claim to be current - which is what happens when
 * marking the old one is a second step somebody has to remember.
 */
export function FileDocument({
  current,
}: {
  current: { id: string; title: string; version: string | null }[];
}) {
  const t = useT();
  const [state, action, saving] = useActionState<RecordsActionState, FormData>(
    fileDocumentAction,
    {},
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass}
      >
        {t("records.file")}
      </button>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <select name="category" className={inputClass}>
          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {maybe(t, `records.category.${value}`) ?? label}
            </option>
          ))}
        </select>
        <input
          name="title"
          required
          placeholder={t("records.titleHint")}
          className={inputClass}
        />
        <input name="version" placeholder={t("records.versionHint")} className={inputClass} />
        <input
          name="reference"
          placeholder={t("records.referenceHint")}
          className={inputClass}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">{t("records.effective")}</span>
          <input type="date" name="effectiveFrom" className={inputClass} />
        </label>
        <label className="text-sm">
          <span className="mr-2 text-[var(--muted)]">{t("records.expiresLabel")}</span>
          <input type="date" name="expiresOn" className={inputClass} />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mr-2 text-[var(--muted)]">{t("records.replaces")}</span>
        <select name="supersedesId" defaultValue="" className={inputClass}>
          <option value="">{t("records.new")}</option>
          {current.map((row) => (
            <option key={row.id} value={row.id}>
              {row.title}
              {row.version ? ` (${row.version})` : ""}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[var(--muted)]">{t("records.replacesNote")}</span>
      </label>

      <textarea
        name="description"
        rows={2}
        placeholder={t("records.descriptionHint")}
        className={`${inputClass} block w-full`}
      />

      {/*
        Who may read it, said as the consequence rather than as a flag.

        Heidi, 21 September: "a learner must not see internal policies."
        Ticking this on a facilitator's contract used to be possible and is
        now refused, so the words say which categories it applies to instead
        of leaving somebody to find out by being overruled silently. A learner
        guide is shown to learners whether or not this is ticked, because that
        is what the category means. See LEARNER_FACING in lib/records.ts.
      */}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="visibleToAll" className="mt-1" />
        <span>
          {t("records.anybody")}
          <span className="block text-xs text-[var(--muted)]">{t("records.anybodyNote")}</span>
        </span>
      </label>

      <input type="file" name="file" required className="block text-sm" />

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? t("records.filing") : t("records.fileIt")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={buttonClass}
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Deciding what happens to a record past its retention date.
 *
 * Three outcomes, and two of them need a reason. Destroying is irreversible and
 * somebody will one day ask why a record a verifier wanted is not there.
 * Keeping something deliberately is a position rather than an oversight, and
 * the reason belongs in the file rather than in somebody's memory.
 */
export function DisposalForm({
  learnerId,
  name,
  dueOn,
}: {
  learnerId: string;
  name: string;
  dueOn: string;
}) {
  const t = useT();
  const [state, action, saving] = useActionState<RecordsActionState, FormData>(
    recordDisposalAction,
    {},
  );
  const [status, setStatus] = useState("archived");

  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="subject" value="learner_documents" />
      <input type="hidden" name="learnerId" value={learnerId} />
      <input type="hidden" name="dueOn" value={dueOn} />

      <div className="flex flex-wrap gap-2">
        <select
          name="status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className={inputClass}
        >
          <option value="archived">{t("records.archive")}</option>
          <option value="retained">{t("records.keep")}</option>
          <option value="destroyed">{t("records.destroy")}</option>
        </select>
        <button type="submit" disabled={saving} className={buttonClass}>
          {saving ? t("records.recording") : t("records.record")}
        </button>
      </div>

      {status !== "archived" ? (
        <input
          name="reason"
          required
          placeholder={status === "destroyed" ? t("records.whyDestroy") : t("records.whyKeep")}
          className={`${inputClass} block w-full`}
        />
      ) : null}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}

      <p className="sr-only">{name}</p>
    </form>
  );
}
