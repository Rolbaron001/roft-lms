"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { updateClassroomAction, type ClockState } from "./actions";

/**
 * The LMS classroom (job sheet D41): live classes held on and from the LMS.
 * Switched on, every online session without an outside meeting link is held
 * in it. Cameras are the design's Option 1; audio only is Option 2.
 */
export function ClassroomForm({
  current,
  configured,
}: {
  current: { enabled: boolean; cameras: boolean; presentPercent: number };
  /** Whether this server has a media server to hold classes on. */
  configured: boolean;
}) {
  const t = useT();
  const [state, action, saving] = useActionState<ClockState, FormData>(updateClassroomAction, {});

  return (
    <Card title={t("classroomSettings.title")} description={t("classroomSettings.note")}>
      <form action={action} className="space-y-4 text-sm">
        {configured ? null : <p className="text-[var(--warning)]">{t("classroomSettings.notConfigured")}</p>}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="enabled" defaultChecked={current.enabled} />
          <span>{t("classroomSettings.enabled")}</span>
        </label>
        <fieldset className="space-y-1.5">
          <legend className="font-medium">{t("classroomSettings.what")}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="cameras" value="video" defaultChecked={current.cameras} />
            <span>{t("classroomSettings.video")}</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="cameras" value="audio" defaultChecked={!current.cameras} />
            <span>{t("classroomSettings.audio")}</span>
          </label>
        </fieldset>
        <label className="flex flex-wrap items-center gap-2">
          <span>{t("classroomSettings.present")}</span>
          <input
            name="presentPercent"
            type="number"
            min={1}
            max={100}
            step={1}
            defaultValue={current.presentPercent}
            className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 tabular-nums"
          />
          <span>{t("classroomSettings.presentAfter")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand-primary)" }}
          >
            {saving ? t("dateStyle.saving") : t("dateStyle.save")}
          </button>
          {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
          {state.error ? <p role="alert" className="text-sm text-[var(--danger)]">{state.error}</p> : null}
        </div>
      </form>
    </Card>
  );
}
