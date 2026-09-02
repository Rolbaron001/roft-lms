"use client";

import { useActionState, useState } from "react";
import {
  closeSupportNeedAction,
  recordReviewAction,
  recordSupportNeedAction,
  type SupportActionState,
} from "@/app/people/support-actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

const CATEGORY_LABEL: Record<string, string> = {
  mobility: "Mobility",
  psychological: "Psychological",
  economic: "Economic",
  sensory: "Sensory",
  other: "Other",
};

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
        <p className="text-sm text-[var(--muted)]">No support recorded.</p>
      ) : (
        <ul className="space-y-4">
          {active.map((row) => (
            <li
              key={row.id}
              className="rounded-md border border-[var(--border)] p-3"
            >
              <p className="text-sm font-medium">
                {CATEGORY_LABEL[row.category] ?? row.category}
                {row.reviewDue ? (
                  <span
                    className={
                      row.reviewDue <= today
                        ? "ml-2 text-xs text-[var(--danger)]"
                        : "ml-2 text-xs text-[var(--muted)]"
                    }
                  >
                    review due {row.reviewDue}
                  </span>
                ) : null}
              </p>

              <p className="mt-1 text-sm">{row.accommodation}</p>

              {canRead && row.need ? (
                <p className="mt-2 border-l-2 border-[var(--border)] pl-3 text-sm text-[var(--muted)]">
                  {row.need}
                </p>
              ) : row.detailWithheld ? (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  There is more detail on file. It is restricted, because it is
                  health or financial information and doing the accommodation
                  does not require knowing the reason for it.
                </p>
              ) : null}

              <p className="mt-2 text-xs text-[var(--muted)]">
                Recorded by {row.raisedByName}
                {row.employerInformed
                  ? ` · employer informed${row.employerRepresentative ? ` (${row.employerRepresentative})` : ""}`
                  : " · employer not informed"}
              </p>

              {canManage ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {reviewingId === row.id ? (
                    <form action={reviewAction} className="w-full space-y-2">
                      <input
                        type="hidden"
                        name="learnerId"
                        value={learnerId}
                      />
                      <input
                        type="hidden"
                        name="supportNeedId"
                        value={row.id}
                      />
                      <div className="flex flex-wrap gap-2">
                        <label className="text-sm">
                          <span className="mr-2 text-[var(--muted)]">
                            Reviewed
                          </span>
                          <input
                            type="date"
                            name="reviewedOn"
                            defaultValue={today}
                            className={inputClass}
                          />
                        </label>
                        <label className="text-sm">
                          <span className="mr-2 text-[var(--muted)]">
                            Working?
                          </span>
                          <select
                            name="working"
                            value={working}
                            onChange={(event) => setWorking(event.target.value)}
                            className={inputClass}
                          >
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </label>
                        <label className="text-sm">
                          <span className="mr-2 text-[var(--muted)]">
                            Next review
                          </span>
                          <input
                            type="date"
                            name="nextReviewDue"
                            className={inputClass}
                          />
                        </label>
                      </div>
                      <textarea
                        name="note"
                        rows={2}
                        placeholder="What you found"
                        className={`${inputClass} block w-full`}
                      />
                      {working === "no" ? (
                        <textarea
                          name="adjustment"
                          rows={2}
                          placeholder="What is changing as a result"
                          className={`${inputClass} block w-full`}
                        />
                      ) : null}
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={reviewing}
                          className={buttonClass}
                        >
                          {reviewing ? "Saving…" : "Save the review"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReviewingId(null)}
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
                        onClick={() => setReviewingId(row.id)}
                        className={buttonClass}
                      >
                        Record a review
                      </button>
                      <form action={closeAction} className="flex gap-2">
                        <input
                          type="hidden"
                          name="learnerId"
                          value={learnerId}
                        />
                        <input
                          type="hidden"
                          name="supportNeedId"
                          value={row.id}
                        />
                        <input
                          name="reason"
                          placeholder="Why it is ending"
                          className={inputClass}
                        />
                        <button type="submit" className={buttonClass}>
                          Close
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
          {closed.length} closed{" "}
          {closed.length === 1 ? "record" : "records"} not shown.
        </p>
      ) : null}

      {canManage ? (
        !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={buttonClass}
          >
            Record a support need
          </button>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="learnerId" value={learnerId} />

            <div className="flex flex-wrap gap-2">
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">Kind</span>
                <select name="category" className={inputClass}>
                  {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">Review due</span>
                <input type="date" name="reviewDue" className={inputClass} />
              </label>
            </div>

            <label className="block text-sm">
              <span className="text-[var(--muted)]">
                What will be done — shared with whoever has to do it
              </span>
              <textarea
                name="accommodation"
                rows={2}
                required
                placeholder="Seat near the door. Allow a break every 40 minutes. Provide printed materials."
                className={`${inputClass} mt-1 block w-full`}
              />
            </label>

            <label className="block text-sm">
              <span className="text-[var(--muted)]">
                The reason behind it — restricted, and better left empty
              </span>
              <textarea
                name="need"
                rows={2}
                className={`${inputClass} mt-1 block w-full`}
              />
              <span className="mt-1 block text-xs text-[var(--muted)]">
                Health, disability and financial circumstances are special
                personal information. A record that says only what to do serves
                the learner just as well and puts far less at risk. Fill this in
                only where somebody genuinely could not act without it.
              </span>
            </label>

            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="learnerConsented" />
                The learner has agreed to this being recorded
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="employerInformed" />
                Employer informed
              </label>
              <input
                name="employerRepresentative"
                placeholder="Who, at the employer"
                className={inputClass}
              />
            </div>

            {state.notice ? (
              <p className="text-sm text-[var(--muted)]">{state.notice}</p>
            ) : null}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Record"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={buttonClass}
              >
                Cancel
              </button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}
