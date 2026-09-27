"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { recordModerationAction, type DecisionState } from "../assess/actions";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Item = {
  decisionId: string;
  outcome: string;
  reason: string;
  assessorName: string;
  assessorId: string;
  assessmentTitle: string;
  courseTitle: string | null;
  submissionId: string;
};

function ModerationForm({ decisionId }: { decisionId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<DecisionState, FormData>(
    recordModerationAction,
    {},
  );
  const [outcome, setOutcome] = useState("endorsed");

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="decisionId" value={decisionId} />

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">{t("moderating.yourReview")}</span>
        <select
          name="outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          className={inputClass}
        >
          <option value="endorsed">{t("moderating.endorse")}</option>
          <option value="referred_back">{t("moderating.referBack")}</option>
          <option value="overridden">{t("moderating.override")}</option>
        </select>
      </label>

      {outcome === "overridden" ? (
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("moderating.replaceWith")}</span>
          <select
            name="revisedOutcome"
            defaultValue="not_yet_competent"
            className={inputClass}
          >
            <option value="competent">{t("common.competent")}</option>
            <option value="not_yet_competent">{t("common.notYetCompetent")}</option>
          </select>
        </label>
      ) : null}

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          {t("moderating.reasons")}{" "}
          <span className="font-normal text-[var(--muted)]">{t("assessing.keptWithRecord")}</span>
        </span>
        <textarea name="comments" rows={3} className={inputClass} />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
          {state.notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? t("assessing.recording") : t("moderating.record")}
      </button>
    </form>
  );
}

export function ModerationList({
  items,
  currentUserId,
}: {
  items: Item[];
  currentUserId: string;
}) {
  const t = useT();
  const [openFor, setOpenFor] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const ownDecision = item.assessorId === currentUserId;

        return (
          <section
            key={item.decisionId}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{item.assessmentTitle}</p>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  {item.courseTitle ? `${item.courseTitle} · ` : ""}
                  {t("moderating.assessedBy", {
                    outcome: maybe(t, `outcome.${item.outcome}`) ?? item.outcome.replace(/_/g, " "),
                    assessor: item.assessorName,
                  })}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {item.reason}
                </p>
              </div>
              <Link
                href={`/assess/${item.submissionId}`}
                className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                {t("moderating.seeEvidence")}
              </Link>
            </div>

            {ownDecision ? (
              <p className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
                {t("moderating.ownDecision")}
              </p>
            ) : openFor === item.decisionId ? (
              <ModerationForm decisionId={item.decisionId} />
            ) : (
              <button
                type="button"
                onClick={() => setOpenFor(item.decisionId)}
                className="mt-3 text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                {t("moderating.moderate")}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
