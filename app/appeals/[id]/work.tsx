"use client";

import { useActionState } from "react";
import {
  acknowledgeAppealAction,
  addNoteAction,
  learnerInformedAction,
  recordProgressAction,
  resolveAppealAction,
  withdrawAppealAction,
  type AppealActionState,
} from "@/app/appeals/actions";
import { ZonedTime } from "@/components/zoned-time";
import { useT } from "@/components/i18n";
import { Rich } from "@/components/rich-text";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

export type WorkAppeal = {
  id: string;
  ground: "result" | "assessor_conduct";
  status: string;
  acknowledgedAt: Date | null;
  metLearnerOn: string | null;
  moderatorId: string | null;
  moderatorName: string | null;
  outcome: string | null;
  outcomeReason: string | null;
  resolvedAt: Date | null;
  learnerInformedAt: Date | null;
  withdrawnReason: string | null;
};

/**
 * The appeal, as the person handling it works it.
 *
 * One page holding the whole procedure in order, because the steps are done by
 * different people days apart and the thing that goes wrong is a step nobody
 * realised was outstanding.
 */
export function Work({
  appeal,
  zone,
  moderators,
  notes,
}: {
  appeal: WorkAppeal;
  zone: string;
  moderators: { id: string; name: string }[];
  notes: {
    id: string;
    note: string;
    visibleToLearner: boolean;
    createdAt: Date;
    authorName: string;
  }[];
}) {
  const t = useT();
  const [ackState, ackAction, acking] = useActionState<
    AppealActionState,
    FormData
  >(acknowledgeAppealAction, {});
  const [progressState, progressAction, progressing] = useActionState<
    AppealActionState,
    FormData
  >(recordProgressAction, {});
  const [resolveState, resolveAction, resolving] = useActionState<
    AppealActionState,
    FormData
  >(resolveAppealAction, {});
  const [informedState, informedAction, informing] = useActionState<
    AppealActionState,
    FormData
  >(learnerInformedAction, {});
  const [withdrawState, withdrawAction, withdrawing] = useActionState<
    AppealActionState,
    FormData
  >(withdrawAppealAction, {});
  const [noteState, noteAction, noting] = useActionState<
    AppealActionState,
    FormData
  >(addNoteAction, {});

  const closed = appeal.status === "resolved" || appeal.status === "withdrawn";
  const error =
    ackState.error ??
    progressState.error ??
    resolveState.error ??
    informedState.error ??
    withdrawState.error ??
    noteState.error;

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      {/* 1. Acknowledge */}
      <section className="border-b border-[var(--border)] pb-4">
        <h3 className="text-sm font-medium">{t("appeals.acknowledge")}</h3>
        {appeal.acknowledgedAt ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            <Rich
              text={t("appeals.acknowledgedAt")}
              parts={{ time: <ZonedTime at={appeal.acknowledgedAt} zone={zone} withDate /> }}
            />
          </p>
        ) : closed ? (
          <p className="mt-1 text-sm text-[var(--muted)]">{t("appeals.closedUnacknowledged")}</p>
        ) : (
          <form action={ackAction} className="mt-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <p className="mb-2 text-xs text-[var(--muted)]">{t("appeals.firstCounts")}</p>
            <button type="submit" disabled={acking} className={buttonClass}>
              {acking ? t("assessing.recording") : t("appeals.acknowledgeButton")}
            </button>
          </form>
        )}
      </section>

      {/* 2. Work it */}
      {!closed ? (
        <section className="border-b border-[var(--border)] pb-4">
          <h3 className="text-sm font-medium">{t("appeals.meeting")}</h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {appeal.ground === "result"
              ? t("appeals.resultNeedsModerator")
              : t("appeals.conductNoModerator")}
          </p>

          <form action={progressAction} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <label className="text-sm">
              <span className="mr-2 text-[var(--muted)]">{t("appeals.met")}</span>
              <input
                type="date"
                name="metLearnerOn"
                defaultValue={appeal.metLearnerOn ?? ""}
                className={inputClass}
              />
            </label>

            {appeal.ground === "result" ? (
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">{t("appeals.moderator")}</span>
                <select
                  name="moderatorId"
                  defaultValue={appeal.moderatorId ?? ""}
                  className={inputClass}
                >
                  <option value="">{t("appeals.notConsulted")}</option>
                  {moderators.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <button type="submit" disabled={progressing} className={buttonClass}>
              {progressing ? t("common.saving") : t("common.save")}
            </button>
          </form>
        </section>
      ) : null}

      {/* 3. Resolve */}
      <section className="border-b border-[var(--border)] pb-4">
        <h3 className="text-sm font-medium">{t("appeals.outcome")}</h3>
        {appeal.status === "resolved" ? (
          <div className="mt-1 space-y-2 text-sm">
            <p>
              <span className="font-medium">
                {appeal.outcome
                  ? maybe(t, `appeals.outcome.${appeal.outcome}`) ?? appeal.outcome.replace(/_/g, " ")
                  : ""}
              </span>{" "}
              <span className="text-[var(--muted)]">
                <ZonedTime at={appeal.resolvedAt} zone={zone} withDate />
              </span>
            </p>
            <p className="whitespace-pre-wrap">{appeal.outcomeReason}</p>

            {appeal.learnerInformedAt ? (
              <p className="text-[var(--muted)]">
                <Rich
                  text={t("appeals.told")}
                  parts={{ time: <ZonedTime at={appeal.learnerInformedAt} zone={zone} withDate /> }}
                />
              </p>
            ) : (
              <form action={informedAction}>
                <input type="hidden" name="appealId" value={appeal.id} />
                <p className="mb-2 text-xs text-[var(--muted)]">{t("appeals.notFeedback")}</p>
                <button type="submit" disabled={informing} className={buttonClass}>
                  {informing ? t("assessing.recording") : t("appeals.hasBeenTold")}
                </button>
              </form>
            )}
          </div>
        ) : appeal.status === "withdrawn" ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("appeals.withdrawnBecause", { reason: appeal.withdrawnReason ?? "" })}
          </p>
        ) : (
          <form action={resolveAction} className="mt-2 space-y-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <select name="outcome" className={inputClass} defaultValue="">
              <option value="" disabled>
                {t("appeals.chooseOutcome")}
              </option>
              <option value="upheld">{t("appeals.outcome.upheld")}</option>
              <option value="partially_upheld">{t("appeals.outcome.partially_upheld")}</option>
              <option value="dismissed">{t("appeals.outcome.dismissed")}</option>
            </select>
            <textarea
              name="outcomeReason"
              rows={3}
              placeholder={t("appeals.whyHint")}
              className={`${inputClass} block w-full`}
            />
            <button type="submit" disabled={resolving} className={buttonClass}>
              {resolving ? t("appeals.resolving") : t("appeals.resolve")}
            </button>
          </form>
        )}
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-sm font-medium">{t("appeals.notes")}</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">{t("appeals.notesIntro")}</p>

        {notes.length > 0 ? (
          <ul className="mt-3 space-y-3 text-sm">
            {notes.map((note) => (
              <li key={note.id}>
                <span className="text-xs text-[var(--muted)]">
                  {note.authorName} ·{" "}
                  <ZonedTime at={note.createdAt} zone={zone} withDate showViewer={false} />
                  {note.visibleToLearner ? t("appeals.visible") : ""}
                </span>
                <p className="whitespace-pre-wrap">{note.note}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <form action={noteAction} className="mt-3 space-y-2">
          <input type="hidden" name="appealId" value={appeal.id} />
          <textarea
            name="note"
            rows={2}
            placeholder={t("appeals.noteHint")}
            className={`${inputClass} block w-full`}
          />
          <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <input type="checkbox" name="visibleToLearner" />
            {t("appeals.learnerMayRead")}
          </label>
          <button type="submit" disabled={noting} className={buttonClass}>
            {noting ? t("common.saving") : t("appeals.addNote")}
          </button>
        </form>
      </section>

      {!closed ? (
        <section className="border-t border-[var(--border)] pt-4">
          <form action={withdrawAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="appealId" value={appeal.id} />
            <input
              name="reason"
              placeholder={t("appeals.withdrawWhy")}
              className={`${inputClass} flex-1 min-w-48`}
            />
            <button type="submit" disabled={withdrawing} className={buttonClass}>
              {withdrawing ? t("appeals.withdrawing") : t("appeals.withdraw")}
            </button>
          </form>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("appeals.withdrawNeedsReason")}</p>
        </section>
      ) : null}
    </div>
  );
}
