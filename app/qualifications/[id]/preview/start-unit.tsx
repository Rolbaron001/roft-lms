"use client";

import { useActionState } from "react";
import { startStudyUnitAction, type StartState } from "./actions";
import { useT } from "@/components/i18n";

/**
 * The way out of "nothing has been built for this study unit yet".
 *
 * Naming a gap and offering no way to close it is half a screen. This makes
 * the course the study unit needs and lands on its empty step list, which is
 * the next thing to do.
 */
export function StartUnit({
  qualificationId,
  studyUnitId,
}: {
  qualificationId: string;
  studyUnitId: string;
}) {
  const t = useT();
  const [state, act, working] = useActionState<StartState, FormData>(
    startStudyUnitAction,
    {},
  );

  return (
    <form action={act} className="mt-2">
      <input type="hidden" name="qualificationId" value={qualificationId} />
      <input type="hidden" name="studyUnitId" value={studyUnitId} />
      <button
        type="submit"
        disabled={working}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "var(--brand-primary)" }}
      >
        {working ? t("qualPreview.starting") : t("qualPreview.start")}
      </button>
      {state.error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
