"use client";
import { DateField } from "@/components/date-field";

import { useActionState, useState } from "react";
import {
  acknowledgeWarningAction,
  closeCaseAction,
  convenehearingAction,
  issueWarningAction,
  openCaseAction,
  outcomeGivenAction,
  recordFindingsAction,
  type ConductActionState,
} from "@/app/conduct/actions";
import { ZonedTime } from "@/components/zoned-time";
import { useT } from "@/components/i18n";
import { Rich } from "@/components/rich-text";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

const SANCTIONS = [
  "no_action",
  "counselled",
  "verbal_warning",
  "written_warning",
  "final_written_warning",
  "terminated",
  "expelled",
] as const;

export type ConductCase = {
  id: string;
  grade: string;
  allegation: string;
  occurredOn: string;
  stage: string;
  sanction: string | null;
  outcomeReason: string | null;
  outcomeGivenAt: Date | null;
  appealBy: string | null;
  closedAt: Date | null;
  hearing: {
    id: string;
    noticeGivenAt: Date;
    scheduledFor: Date;
    allegations: string;
    sanctionsAdvised: string;
    heldAt: Date | null;
    findings: string | null;
  } | null;
  warnings: {
    id: string;
    kind: string;
    issuedOn: string;
    validUntil: string;
    terms: string;
    acknowledgedAt: Date | null;
  }[];
};

/**
 * A learner's disciplinary record.
 *
 * One page holding the whole matter in the order it happened, because that is
 * the order it gets read back in - by a sponsor, or at a referral - and a
 * folder of emails cannot produce it.
 */
export function Conduct({
  learnerId,
  zone,
  cases,
  today,
  noticeHours,
}: {
  learnerId: string;
  zone: string;
  cases: ConductCase[];
  today: string;
  /** The least notice a hearing may be given (lib/conduct, server side). */
  noticeHours: number;
}) {
  const t = useT();
  const warningLabel = (kind: string) => maybe(t, `conduct.warning.${kind}`) ?? kind;
  const [openState, openAction, opening] = useActionState<
    ConductActionState,
    FormData
  >(openCaseAction, {});
  const [warnState, warnAction, warning] = useActionState<
    ConductActionState,
    FormData
  >(issueWarningAction, {});
  const [ackState, ackAction] = useActionState<ConductActionState, FormData>(
    acknowledgeWarningAction,
    {},
  );
  const [hearState, hearAction, hearing] = useActionState<
    ConductActionState,
    FormData
  >(convenehearingAction, {});
  const [findState, findAction, finding] = useActionState<
    ConductActionState,
    FormData
  >(recordFindingsAction, {});
  const [closeState, closeAction, closing] = useActionState<
    ConductActionState,
    FormData
  >(closeCaseAction, {});
  const [givenState, givenAction] = useActionState<ConductActionState, FormData>(
    outcomeGivenAction,
    {},
  );

  const [opening_, setOpening] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const error =
    openState.error ??
    warnState.error ??
    ackState.error ??
    hearState.error ??
    findState.error ??
    closeState.error ??
    givenState.error;

  const live = cases
    .flatMap((matter) => matter.warnings)
    .filter((warning) => warning.validUntil >= today);

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      {live.length > 0 ? (
        <p className="rounded-md border border-[var(--border)] p-3 text-sm">
          <span className="font-medium">
            {live.length === 1 ? t("conduct.liveOne") : t("conduct.liveMany", { count: live.length })}
          </span>{" "}
          {live
            .map((warning) =>
              t("conduct.until", { warning: warningLabel(warning.kind), date: warning.validUntil }),
            )
            .join(", ")}
          .
          <span className="mt-1 block text-xs text-[var(--muted)]">{t("conduct.liveNote")}</span>
        </p>
      ) : null}

      {cases.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("conduct.nothing")}</p>
      ) : (
        <ul className="space-y-4">
          {cases.map((matter) => (
            <li key={matter.id} className="rounded-md border border-[var(--border)] p-3">
              <p className="text-sm font-medium">
                {maybe(t, `conduct.grade.${matter.grade}`) ?? matter.grade}
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  {matter.occurredOn} · {maybe(t, `conduct.stage.${matter.stage}`) ?? matter.stage}
                </span>
              </p>
              <p className="mt-1 text-sm">{matter.allegation}</p>

              {matter.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {matter.warnings.map((warning) => (
                    <li key={warning.id}>
                      <span className={warning.validUntil >= today ? "font-medium" : "text-[var(--muted)]"}>
                        {warningLabel(warning.kind)}
                      </span>{" "}
                      <span className="text-[var(--muted)]">
                        {t("conduct.period", { from: warning.issuedOn, until: warning.validUntil })}
                        {warning.validUntil < today ? t("conduct.expired") : ""}
                        {warning.acknowledgedAt ? t("conduct.signedFor") : ""}
                      </span>
                      {!warning.acknowledgedAt ? (
                        <form action={ackAction} className="mt-1 inline">
                          <input type="hidden" name="learnerId" value={learnerId} />
                          <input type="hidden" name="warningId" value={warning.id} />
                          <button type="submit" className="ml-2 text-xs underline">
                            {t("conduct.recordSignature")}
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {matter.hearing ? (
                <div className="mt-2 rounded-md border border-[var(--border)] p-2 text-xs">
                  <p>
                    <Rich
                      text={t("conduct.hearingAt")}
                      parts={{
                        when: (
                          <ZonedTime at={matter.hearing.scheduledFor} zone={zone} withDate showViewer={false} />
                        ),
                        notice: (
                          <ZonedTime at={matter.hearing.noticeGivenAt} zone={zone} withDate showViewer={false} />
                        ),
                      }}
                    />
                  </p>
                  {matter.hearing.findings ? (
                    <p className="mt-1">{matter.hearing.findings}</p>
                  ) : (
                    <form action={findAction} className="mt-2 space-y-1">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="hearingId" value={matter.hearing.id} />
                      <input name="assistedBy" placeholder={t("conduct.assistedBy")} className={inputClass} />
                      <textarea
                        name="findings"
                        rows={2}
                        placeholder={t("conduct.findingsHint")}
                        className={`${inputClass} block w-full`}
                      />
                      <button type="submit" disabled={finding} className={buttonClass}>
                        {finding ? t("common.saving") : t("conduct.recordFindings")}
                      </button>
                    </form>
                  )}
                </div>
              ) : null}

              {matter.closedAt ? (
                <div className="mt-2 text-sm">
                  <p>
                    <span className="font-medium">
                      {matter.sanction
                        ? maybe(t, `conduct.sanction.${matter.sanction}`) ?? matter.sanction.replace(/_/g, " ")
                        : ""}
                    </span>
                    {matter.appealBy ? (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        {t("conduct.appealBy", { date: matter.appealBy })}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1">{matter.outcomeReason}</p>
                  {matter.outcomeGivenAt ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      <Rich
                        text={t("conduct.given")}
                        parts={{
                          when: <ZonedTime at={matter.outcomeGivenAt} zone={zone} withDate showViewer={false} />,
                        }}
                      />
                    </p>
                  ) : (
                    <form action={givenAction} className="mt-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="caseId" value={matter.id} />
                      <button type="submit" className={buttonClass}>
                        {t("conduct.givenButton")}
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {acting === `warn:${matter.id}` ? (
                    <form action={warnAction} className="w-full space-y-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="caseId" value={matter.id} />
                      <div className="flex flex-wrap gap-2">
                        <select name="kind" className={inputClass}>
                          {(["verbal", "written", "final_written"] as const).map((kind) => (
                            <option key={kind} value={kind}>
                              {t(`conduct.warning.${kind}`)}
                            </option>
                          ))}
                        </select>
                        <DateField name="issuedOn" defaultValue={today} className={inputClass} />
                      </div>
                      <textarea
                        name="terms"
                        rows={2}
                        defaultValue={warnState.values?.terms}
                        placeholder={t("conduct.termsHint")}
                        className={`${inputClass} block w-full`}
                      />
                      <div className="flex gap-2">
                        <button type="submit" disabled={warning} className={buttonClass}>
                          {warning ? t("conduct.issuing") : t("conduct.issue")}
                        </button>
                        <button type="button" onClick={() => setActing(null)} className={buttonClass}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </form>
                  ) : acting === `hear:${matter.id}` ? (
                    <form action={hearAction} className="w-full space-y-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="caseId" value={matter.id} />
                      <label className="block text-sm">
                        <span className="mr-2 text-[var(--muted)]">{t("conduct.dateTime")}</span>
                        <input type="datetime-local" name="scheduledFor" required className={inputClass} />
                      </label>
                      <input name="venue" placeholder={t("conduct.venue")} className={`${inputClass} block w-full`} />
                      <input
                        name="meetingUrl"
                        placeholder={t("conduct.link")}
                        className={`${inputClass} block w-full`}
                      />
                      <textarea
                        name="allegations"
                        rows={2}
                        defaultValue={hearState.values?.allegations ?? matter.allegation}
                        placeholder={t("conduct.allegationsHint")}
                        className={`${inputClass} block w-full`}
                      />
                      <input
                        name="sanctionsAdvised"
                        defaultValue={hearState.values?.sanctionsAdvised}
                        placeholder={t("conduct.sanctionsHint")}
                        className={`${inputClass} block w-full`}
                      />
                      <label className="flex items-start gap-2 text-xs">
                        <input type="checkbox" name="rightsAdvised" />
                        <span>{t("conduct.rights")}</span>
                      </label>
                      <p className="text-xs text-[var(--muted)]">{t("conduct.notice", { hours: noticeHours })}</p>
                      <div className="flex gap-2">
                        <button type="submit" disabled={hearing} className={buttonClass}>
                          {hearing ? t("conduct.convening") : t("conduct.convene")}
                        </button>
                        <button type="button" onClick={() => setActing(null)} className={buttonClass}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </form>
                  ) : acting === `close:${matter.id}` ? (
                    <form action={closeAction} className="w-full space-y-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="caseId" value={matter.id} />
                      <select name="sanction" className={inputClass}>
                        {SANCTIONS.map((sanction) => (
                          <option key={sanction} value={sanction}>
                            {t(`conduct.sanction.${sanction}`)}
                          </option>
                        ))}
                      </select>
                      <textarea
                        name="outcomeReason"
                        rows={2}
                        defaultValue={closeState.values?.outcomeReason}
                        placeholder={t("conduct.whyHint")}
                        className={`${inputClass} block w-full`}
                      />
                      <div className="flex gap-2">
                        <button type="submit" disabled={closing} className={buttonClass}>
                          {closing ? t("conduct.closing") : t("conduct.closeCase")}
                        </button>
                        <button type="button" onClick={() => setActing(null)} className={buttonClass}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button type="button" onClick={() => setActing(`warn:${matter.id}`)} className={buttonClass}>
                        {t("conduct.issueWarning")}
                      </button>
                      {!matter.hearing ? (
                        <button type="button" onClick={() => setActing(`hear:${matter.id}`)} className={buttonClass}>
                          {t("conduct.conveneHearing")}
                        </button>
                      ) : null}
                      <button type="button" onClick={() => setActing(`close:${matter.id}`)} className={buttonClass}>
                        {t("conduct.close")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!opening_ ? (
        <button type="button" onClick={() => setOpening(true)} className={buttonClass}>
          {t("conduct.openCase")}
        </button>
      ) : (
        <form action={openAction} className="space-y-2">
          <input type="hidden" name="learnerId" value={learnerId} />
          <div className="flex flex-wrap gap-2">
            <select name="grade" defaultValue={openState.values?.grade ?? "minor"} className={inputClass}>
              {(["minor", "serious", "gross"] as const).map((grade) => (
                <option key={grade} value={grade}>
                  {t(`conduct.grade.${grade}`)}
                </option>
              ))}
            </select>
            <DateField
              name="occurredOn"
              defaultValue={openState.values?.occurredOn ?? today}
              required
              className={inputClass}
            />
          </div>
          <textarea
            name="allegation"
            rows={2}
            required
            defaultValue={openState.values?.allegation}
            placeholder={t("conduct.allegationHint")}
            className={`${inputClass} block w-full`}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={opening}
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {opening ? t("conduct.opening") : t("conduct.open")}
            </button>
            <button type="button" onClick={() => setOpening(false)} className={buttonClass}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
