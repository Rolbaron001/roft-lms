"use client";

import { useActionState, useState } from "react";
import {
  closeSupportNeedAction,
  recordReviewAction,
  recordSupportNeedAction,
  type SupportActionState,
} from "@/app/people/support-actions";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

const CATEGORIES = ["mobility", "psychological", "economic", "sensory", "other"] as const;

export type SupportRow = {
  id: string;
  category: string;
  need: string | null;
  detailWithheld: boolean;
  accommodation: string;
  employerInformed: boolean;
  employerRepresentative: string | null;
  status: string;
  reviewDue: string | null;
  raisedByName: string;
};

/**
 * Support needs on the learner's page.
 *
 * What a reader sees depends on what they hold. Somebody who can only act gets
 * the accommodation, and is told plainly when there is detail behind it that is
 * not theirs to read - so they can tell "nothing more to know" from "not mine
 * to see", and go and ask if it matters.
 */
export function Support({
  learnerId,
  records,
  canRead,
  canManage,
  today,
}: {
  learnerId: string;
  records: SupportRow[];
  canRead: boolean;
  canManage: boolean;
  today: string;
}) {
  const t = useT();
  const [state, action, saving] = useActionState<SupportActionState, FormData>(
    recordSupportNeedAction,
    {},
  );
  const [reviewState, reviewAction, reviewing] = useActionState<
    SupportActionState,
    FormData
  >(recordReviewAction, {});
  const [closeState, closeAction] = useActionState<SupportActionState, FormData>(
    closeSupportNeedAction,
    {},
  );
  const [open, setOpen] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [working, setWorking] = useState("yes");

  const active = records.filter((row) => row.status === "active");
  const closed = records.filter((row) => row.status !== "active");
  const error = state.error ?? reviewState.error ?? closeState.error;

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      {active.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("support.none")}</p>
      ) : (
        <ul className="space-y-4">
          {active.map((row) => (
            <li key={row.id} className="rounded-md border border-[var(--border)] p-3">
              <p className="text-sm font-medium">
                {maybe(t, `support.category.${row.category}`) ?? row.category}
                {row.reviewDue ? (
                  <span
                    className={
                      row.reviewDue <= today
                        ? "ml-2 text-xs text-[var(--danger)]"
                        : "ml-2 text-xs text-[var(--muted)]"
                    }
                  >
                    {t("support.reviewDue", { date: row.reviewDue })}
                  </span>
                ) : null}
              </p>

              <p className="mt-1 text-sm">{row.accommodation}</p>

              {canRead && row.need ? (
                <p className="mt-2 border-l-2 border-[var(--border)] pl-3 text-sm text-[var(--muted)]">
                  {row.need}
                </p>
              ) : row.detailWithheld ? (
                <p className="mt-2 text-xs text-[var(--muted)]">{t("support.withheld")}</p>
              ) : null}

              <p className="mt-2 text-xs text-[var(--muted)]">
                {t("support.recordedBy", { name: row.raisedByName })}
                {row.employerInformed
                  ? `${t("support.employerInformed")}${row.employerRepresentative ? ` (${row.employerRepresentative})` : ""}`
                  : t("support.employerNotInformed")}
              </p>

              {canManage ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {reviewingId === row.id ? (
                    <form action={reviewAction} className="w-full space-y-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="supportNeedId" value={row.id} />
                      <div className="flex flex-wrap gap-2">
                        <label className="text-sm">
                          <span className="mr-2 text-[var(--muted)]">{t("support.reviewed")}</span>
                          <input type="date" name="reviewedOn" defaultValue={today} className={inputClass} />
                        </label>
                        <label className="text-sm">
                          <span className="mr-2 text-[var(--muted)]">{t("support.working")}</span>
                          <select
                            name="working"
                            value={working}
                            onChange={(event) => setWorking(event.target.value)}
                            className={inputClass}
                          >
                            <option value="yes">{t("support.yes")}</option>
                            <option value="no">{t("support.no")}</option>
                          </select>
                        </label>
                        <label className="text-sm">
                          <span className="mr-2 text-[var(--muted)]">{t("support.nextReview")}</span>
                          <input type="date" name="nextReviewDue" className={inputClass} />
                        </label>
                      </div>
                      <textarea
                        name="note"
                        rows={2}
                        placeholder={t("support.found")}
                        className={`${inputClass} block w-full`}
                      />
                      {working === "no" ? (
                        <textarea
                          name="adjustment"
                          rows={2}
                          placeholder={t("support.changing")}
                          className={`${inputClass} block w-full`}
                        />
                      ) : null}
                      <div className="flex gap-2">
                        <button type="submit" disabled={reviewing} className={buttonClass}>
                          {reviewing ? t("common.saving") : t("support.saveReview")}
                        </button>
                        <button type="button" onClick={() => setReviewingId(null)} className={buttonClass}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button type="button" onClick={() => setReviewingId(row.id)} className={buttonClass}>
                        {t("support.recordReview")}
                      </button>
                      <form action={closeAction} className="flex gap-2">
                        <input type="hidden" name="learnerId" value={learnerId} />
                        <input type="hidden" name="supportNeedId" value={row.id} />
                        <input name="reason" placeholder={t("support.whyEnding")} className={inputClass} />
                        <button type="submit" className={buttonClass}>
                          {t("support.close")}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {closed.length > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          {closed.length === 1
            ? t("support.closedOne")
            : t("support.closedMany", { count: closed.length })}
        </p>
      ) : null}

      {canManage ? (
        !open ? (
          <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
            {t("support.recordNeed")}
          </button>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="learnerId" value={learnerId} />

            <div className="flex flex-wrap gap-2">
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">{t("support.kind")}</span>
                <select name="category" className={inputClass}>
                  {CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {t(`support.category.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">{t("support.reviewDueLabel")}</span>
                <input type="date" name="reviewDue" className={inputClass} />
              </label>
            </div>

            <label className="block text-sm">
              <span className="text-[var(--muted)]">{t("support.accommodation")}</span>
              <textarea
                name="accommodation"
                rows={2}
                required
                placeholder={t("support.accommodationHint")}
                className={`${inputClass} mt-1 block w-full`}
              />
            </label>

            <label className="block text-sm">
              <span className="text-[var(--muted)]">{t("support.reason")}</span>
              <textarea name="need" rows={2} className={`${inputClass} mt-1 block w-full`} />
              <span className="mt-1 block text-xs text-[var(--muted)]">{t("support.reasonNote")}</span>
            </label>

            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="learnerConsented" />
                {t("support.consented")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="employerInformed" />
                {t("support.informed")}
              </label>
              <input name="employerRepresentative" placeholder={t("support.who")} className={inputClass} />
            </div>

            {state.notice ? <p className="text-sm text-[var(--muted)]">{state.notice}</p> : null}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? t("common.saving") : t("support.record")}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={buttonClass}>
                {t("common.cancel")}
              </button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}
