"use client";

import Link from "next/link";
import { useActionState } from "react";
import { draftAction, type NotifyState } from "@/app/statutory/notify/actions";
import { useDay, useT } from "@/components/i18n";

/**
 * The LEISA on the cohort (job sheet D19, Heidi and Roland, 8 October 2026:
 * the QCTO's LEISA workbook is "the starting point for building a new
 * cohort"). What each learner still lacks for it, the deadline counted from
 * the induction, and one button to draft the submission for everyone not yet
 * notified; the workbook is then downloaded and recorded as sent on the
 * enrolment notification page.
 */
export function CohortLeisa({
  cohortId,
  cohortName,
  learners,
  gaps,
}: {
  cohortId: string;
  cohortName: string;
  learners: { userId: string; name: string; state: string; dueOn: string | null; notifiedOn: string | null; inductionOn: string | null; kind: string | null }[];
  gaps: { userId: string | null; learner: string; fields: string[] }[];
}) {
  const t = useT();
  const { day } = useDay();
  const [state, act, pending] = useActionState<NotifyState, FormData>(draftAction, {});

  const waiting = learners.filter((row) => row.state !== "notified" && row.state !== "no_induction");
  const noInduction = learners.some((row) => row.state === "no_induction");
  const inductionOn = waiting[0]?.inductionOn ?? null;
  const dueOn = waiting.map((row) => row.dueOn).filter((date): date is string => Boolean(date)).sort()[0] ?? null;

  if (learners.length === 0) return <p className="text-sm text-[var(--muted)]">{t("leisa.noLearners")}</p>;

  return (
    <div className="space-y-4 text-sm">
      {noInduction ? (
        <p>
          {t("leisa.noInduction")}{" "}
          <a href="#sessions" className="font-medium text-[var(--brand-primary)] underline underline-offset-2">
            {t("leisa.addInduction")}
          </a>
        </p>
      ) : dueOn ? (
        <p>
          {t("leisa.due", { date: day(dueOn), induction: inductionOn ? day(inductionOn) : "" })}
        </p>
      ) : (
        <p className="text-[var(--success)]">{t("leisa.allNotified")}</p>
      )}

      {gaps.length > 0 ? (
        <div>
          <p className="font-medium">{t("leisa.missing", { count: gaps.length })}</p>
          <ul className="mt-1 space-y-1">
            {gaps.map((gap) => (
              <li key={gap.learner}>
                {gap.userId ? (
                  <Link href={`/enrolment-form?learner=${gap.userId}`} className="font-medium underline underline-offset-2">
                    {gap.learner}
                  </Link>
                ) : (
                  <span className="font-medium">{gap.learner}</span>
                )}
                <span className="text-[var(--muted)]">: {gap.fields.join(", ")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("leisa.missingNote")}</p>
        </div>
      ) : (
        <p className="text-[var(--success)]">{t("leisa.complete")}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {waiting.length > 0 && inductionOn ? (
          <form action={act}>
            <input type="hidden" name="cohortId" value={cohortId} />
            <input type="hidden" name="inductionOn" value={inductionOn} />
            <input type="hidden" name="title" value={`LEISA ${cohortName}`} />
            {waiting[0]?.kind ? <input type="hidden" name="kind" value={waiting[0].kind} /> : null}
            {waiting.map((row) => (
              <input key={row.userId} type="hidden" name="learnerIds" value={row.userId} />
            ))}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md px-4 py-2 font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {pending ? t("leisa.drafting") : t("leisa.draft", { count: waiting.length })}
            </button>
          </form>
        ) : null}
        <Link href="/statutory/notify#submissions" className="underline underline-offset-2">
          {t("leisa.openSubmissions")}
        </Link>
      </div>
      {state.notice ? <p role="status" className="text-[var(--success)]">{state.notice}</p> : null}
      {state.error ? <p role="alert" className="text-[var(--danger)]">{state.error}</p> : null}
    </div>
  );
}
