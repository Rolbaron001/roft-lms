"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestFeedbackAction,
  type FeedbackActionState,
} from "@/app/feedback/actions";
import { ZonedTime } from "@/components/zoned-time";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Asking a cohort for feedback, and what has come back.
 *
 * The procedure sends this the day after a summative. Two of its steps vanish
 * here: nobody acknowledges receipt, because receipt is a row, and nobody
 * transcribes anything into a spreadsheet, because the report is a query.
 */
export function Feedback({
  cohortId,
  zone,
  assessments,
  requests,
  canAsk,
}: {
  cohortId: string;
  zone: string;
  assessments: { id: string; title: string }[];
  requests: {
    id: string;
    assessmentTitle: string | null;
    sentAt: Date;
    dueAt: Date;
    answered: number;
  }[];
  canAsk: boolean;
}) {
  const [state, action, saving] = useActionState<FeedbackActionState, FormData>(
    requestFeedbackAction,
    {},
  );

  return (
    <div className="space-y-4">
      {requests.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Nobody has been asked yet.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {requests.map((request) => (
            <li
              key={request.id}
              className="flex flex-wrap items-baseline gap-x-3"
            >
              <Link
                href={`/feedback/${request.id}`}
                className="font-medium hover:underline"
              >
                {request.assessmentTitle ?? "The programme"}
              </Link>
              <span className="text-[var(--muted)]">
                asked{" "}
                <ZonedTime
                  at={request.sentAt}
                  zone={zone}
                  withDate
                  showViewer={false}
                />
              </span>
              <span className="tabular-nums">
                {request.answered}{" "}
                {request.answered === 1 ? "answer" : "answers"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      {canAsk ? (
        <form action={action} className="flex flex-wrap gap-2">
          <input type="hidden" name="cohortId" value={cohortId} />
          <select name="assessmentId" className={inputClass} defaultValue="">
            <option value="">The programme overall</option>
            {assessments.map((assessment) => (
              <option key={assessment.id} value={assessment.id}>
                After {assessment.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {saving ? "Asking…" : "Ask for feedback"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
