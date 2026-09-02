"use client";

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

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

const GRADE_LABEL: Record<string, string> = {
  minor: "Minor misconduct",
  serious: "Serious misconduct",
  gross: "Gross misconduct",
};

const STAGE_LABEL: Record<string, string> = {
  informal_counselling: "Informal counselling",
  verbal_warning: "Verbal warning",
  written_warning: "Written warning",
  final_written_warning: "Final written warning",
  hearing: "Hearing",
  closed: "Closed",
};

const WARNING_LABEL: Record<string, string> = {
  verbal: "Verbal",
  written: "Written",
  final_written: "Final written",
};

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
}: {
  learnerId: string;
  zone: string;
  cases: ConductCase[];
  today: string;
}) {
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
            {live.length} live {live.length === 1 ? "warning" : "warnings"}:
          </span>{" "}
          {live
            .map(
              (warning) =>
                `${WARNING_LABEL[warning.kind] ?? warning.kind} until ${warning.validUntil}`,
            )
            .join(", ")}
          .
          <span className="mt-1 block text-xs text-[var(--muted)]">
            Only these count towards escalation. A warning past its date stays
            on file and stops counting, which is what an appeal turns on.
          </span>
        </p>
      ) : null}

      {cases.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing on record.</p>
      ) : (
        <ul className="space-y-4">
          {cases.map((matter) => (
            <li
              key={matter.id}
              className="rounded-md border border-[var(--border)] p-3"
            >
              <p className="text-sm font-medium">
                {GRADE_LABEL[matter.grade] ?? matter.grade}
                <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                  {matter.occurredOn} · {STAGE_LABEL[matter.stage] ?? matter.stage}
                </span>
              </p>
              <p className="mt-1 text-sm">{matter.allegation}</p>

              {matter.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {matter.warnings.map((warning) => (
                    <li key={warning.id}>
                      <span
                        className={
                          warning.validUntil >= today
                            ? "font-medium"
                            : "text-[var(--muted)]"
                        }
                      >
                        {WARNING_LABEL[warning.kind] ?? warning.kind} warning
                      </span>{" "}
                      <span className="text-[var(--muted)]">
                        {warning.issuedOn} — {warning.validUntil}
                        {warning.validUntil < today ? " (expired)" : ""}
                        {warning.acknowledgedAt ? " · signed for" : ""}
                      </span>
                      {!warning.acknowledgedAt ? (
                        <form action={ackAction} className="mt-1 inline">
                          <input type="hidden" name="learnerId" value={learnerId} />
                          <input
                            type="hidden"
                            name="warningId"
                            value={warning.id}
                          />
                          <button type="submit" className="text-xs underline">
                            record the learner&rsquo;s signature
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
                    Hearing{" "}
                    <ZonedTime
                      at={matter.hearing.scheduledFor}
                      zone={zone}
                      withDate
                      showViewer={false}
                    />
                    , notice given{" "}
                    <ZonedTime
                      at={matter.hearing.noticeGivenAt}
                      zone={zone}
                      withDate
                      showViewer={false}
                    />
                    .
                  </p>
                  {matter.hearing.findings ? (
                    <p className="mt-1">{matter.hearing.findings}</p>
                  ) : (
                    <form action={findAction} className="mt-2 space-y-1">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input
                        type="hidden"
                        name="hearingId"
                        value={matter.hearing.id}
                      />
                      <input
                        name="assistedBy"
                        placeholder="Who assisted the learner"
                        className={inputClass}
                      />
                      <textarea
                        name="findings"
                        rows={2}
                        placeholder="What was found, and on what basis"
                        className={`${inputClass} block w-full`}
                      />
                      <button
                        type="submit"
                        disabled={finding}
                        className={buttonClass}
                      >
                        {finding ? "Saving…" : "Record the findings"}
                      </button>
                    </form>
                  )}
                </div>
              ) : null}

              {matter.closedAt ? (
                <div className="mt-2 text-sm">
                  <p>
                    <span className="font-medium capitalize">
                      {matter.sanction?.replace(/_/g, " ")}
                    </span>
                    {matter.appealBy ? (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        appeal by {matter.appealBy}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1">{matter.outcomeReason}</p>
                  {matter.outcomeGivenAt ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Given to the learner{" "}
                      <ZonedTime
                        at={matter.outcomeGivenAt}
                        zone={zone}
                        withDate
                        showViewer={false}
                      />
                      .
                    </p>
                  ) : (
                    <form action={givenAction} className="mt-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="caseId" value={matter.id} />
                      <button type="submit" className={buttonClass}>
                        The learner has been given this in writing
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
                          <option value="verbal">Verbal warning</option>
                          <option value="written">Written warning</option>
                          <option value="final_written">
                            Final written warning
                          </option>
                        </select>
                        <input
                          type="date"
                          name="issuedOn"
                          defaultValue={today}
                          className={inputClass}
                        />
                      </div>
                      <textarea
                        name="terms"
                        rows={2}
                        defaultValue={warnState.values?.terms}
                        placeholder="The rule broken, the standard expected, and what happens if it recurs."
                        className={`${inputClass} block w-full`}
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={warning}
                          className={buttonClass}
                        >
                          {warning ? "Issuing…" : "Issue"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActing(null)}
                          className={buttonClass}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : acting === `hear:${matter.id}` ? (
                    <form action={hearAction} className="w-full space-y-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="caseId" value={matter.id} />
                      <label className="block text-sm">
                        <span className="mr-2 text-[var(--muted)]">
                          Date and time
                        </span>
                        <input
                          type="datetime-local"
                          name="scheduledFor"
                          required
                          className={inputClass}
                        />
                      </label>
                      <input
                        name="venue"
                        placeholder="Venue"
                        className={`${inputClass} block w-full`}
                      />
                      <input
                        name="meetingUrl"
                        placeholder="Or a meeting link"
                        className={`${inputClass} block w-full`}
                      />
                      <textarea
                        name="allegations"
                        rows={2}
                        defaultValue={
                          hearState.values?.allegations ?? matter.allegation
                        }
                        placeholder="The specific allegations put to the learner"
                        className={`${inputClass} block w-full`}
                      />
                      <input
                        name="sanctionsAdvised"
                        defaultValue={hearState.values?.sanctionsAdvised}
                        placeholder="Sanctions possible, including termination where it is"
                        className={`${inputClass} block w-full`}
                      />
                      <label className="flex items-start gap-2 text-xs">
                        <input type="checkbox" name="rightsAdvised" />
                        <span>
                          The notice tells the learner they may be assisted by a
                          fellow learner, present their case, and call and
                          question witnesses.
                        </span>
                      </label>
                      <p className="text-xs text-[var(--muted)]">
                        At least 48 hours from now. Short notice is refused: it
                        is the defect an appeal is won on, whatever the learner
                        did.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={hearing}
                          className={buttonClass}
                        >
                          {hearing ? "Convening…" : "Convene"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActing(null)}
                          className={buttonClass}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : acting === `close:${matter.id}` ? (
                    <form action={closeAction} className="w-full space-y-2">
                      <input type="hidden" name="learnerId" value={learnerId} />
                      <input type="hidden" name="caseId" value={matter.id} />
                      <select name="sanction" className={inputClass}>
                        <option value="no_action">No action</option>
                        <option value="counselled">Counselled</option>
                        <option value="verbal_warning">Verbal warning</option>
                        <option value="written_warning">Written warning</option>
                        <option value="final_written_warning">
                          Final written warning
                        </option>
                        <option value="terminated">Terminated</option>
                        <option value="expelled">Expelled</option>
                      </select>
                      <textarea
                        name="outcomeReason"
                        rows={2}
                        defaultValue={closeState.values?.outcomeReason}
                        placeholder="Why. This is the paragraph the learner is entitled to."
                        className={`${inputClass} block w-full`}
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={closing}
                          className={buttonClass}
                        >
                          {closing ? "Closing…" : "Close the case"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setActing(null)}
                          className={buttonClass}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setActing(`warn:${matter.id}`)}
                        className={buttonClass}
                      >
                        Issue a warning
                      </button>
                      {!matter.hearing ? (
                        <button
                          type="button"
                          onClick={() => setActing(`hear:${matter.id}`)}
                          className={buttonClass}
                        >
                          Convene a hearing
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setActing(`close:${matter.id}`)}
                        className={buttonClass}
                      >
                        Close
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
        <button
          type="button"
          onClick={() => setOpening(true)}
          className={buttonClass}
        >
          Open a case
        </button>
      ) : (
        <form action={openAction} className="space-y-2">
          <input type="hidden" name="learnerId" value={learnerId} />
          <div className="flex flex-wrap gap-2">
            <select
              name="grade"
              defaultValue={openState.values?.grade ?? "minor"}
              className={inputClass}
            >
              <option value="minor">Minor misconduct</option>
              <option value="serious">Serious misconduct</option>
              <option value="gross">Gross misconduct</option>
            </select>
            <input
              type="date"
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
            placeholder="What is alleged, specifically. A learner cannot answer 'poor attitude'."
            className={`${inputClass} block w-full`}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={opening}
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {opening ? "Opening…" : "Open"}
            </button>
            <button
              type="button"
              onClick={() => setOpening(false)}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
