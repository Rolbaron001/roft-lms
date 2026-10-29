"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { LIVE_CLASS_METHODS, type LiveClassMethod } from "@/lib/classroom-rules";
import { updateClassroomAction, type ClockState } from "./actions";

/**
 * Live classes (job sheet D41): how the provider usually holds them (Roland,
 * 29 October 2026), and the LMS classroom's own settings. Each online session
 * is held the usual way unless it is given its own. Cameras are the design's
 * Option 1; audio only is Option 2.
 */
export function ClassroomForm({
  current,
  configured,
  transcription,
  allowance,
  withoutRoom,
}: {
  current: { method: LiveClassMethod; cameras: boolean; presentPercent: number; attendanceTarget: number | null; transcribe: boolean };
  /** Whether this server has a media server to hold classes on. */
  configured: boolean;
  /** Whether it also has the transcriber (phase B). */
  transcription: boolean;
  /** Classes at once in the classroom, set by the operator; null for no allowance of its own. */
  allowance: number | null;
  /** Classes from today on that the classroom has no room for, to be held another way. */
  withoutRoom: { href: string; label: string }[];
}) {
  const t = useT();
  const [state, action, saving] = useActionState<ClockState, FormData>(updateClassroomAction, {});
  const offered = allowance !== 0;

  return (
    <Card title={t("classroomSettings.title")} description={t("classroomSettings.note")}>
      {/* Keyed by what is saved, so the form shows it after a save rather than the defaults it was first drawn with. */}
      <form key={JSON.stringify(current)} action={action} className="space-y-4 text-sm">
        <fieldset className="space-y-1.5">
          <legend className="font-medium">{t("classroomSettings.method")}</legend>
          {LIVE_CLASS_METHODS.filter((method) => offered || method !== "lms_classroom").map((method) => (
            <label key={method} className="flex items-start gap-2">
              <input type="radio" name="method" value={method} defaultChecked={current.method === method} className="mt-1" />
              <span>
                {t(`classroomSettings.method.${method}`)}
                <span className="block text-xs text-[var(--muted)]">{t(`classroomSettings.method.${method}.hint`)}</span>
              </span>
            </label>
          ))}
          <p className="text-xs text-[var(--muted)]">{t("classroomSettings.methodSession")}</p>
        </fieldset>

        {offered ? (
          <div className="space-y-4 border-t border-[var(--border)] pt-4">
            <p className="font-medium">{t("classroomSettings.inClassroom")}</p>
            {configured ? null : <p className="text-[var(--warning)]">{t("classroomSettings.notConfigured")}</p>}
            {allowance !== null ? <p className="text-[var(--muted)]">{t("classroomSettings.allowance", { count: allowance })}</p> : null}
            {withoutRoom.length > 0 ? (
              <div role="status" className="rounded-md border border-[var(--warning)] p-3">
                <p>{t("classroomSettings.withoutRoom", { count: withoutRoom.length })}</p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                  {withoutRoom.map((one) => (
                    <li key={one.href}>
                      <Link href={one.href} className="text-[var(--brand-accent)] hover:underline">{one.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
            <div className="space-y-1">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="transcribe" defaultChecked={current.transcribe} disabled={!transcription} />
                <span>{t("classroomSettings.transcribe")}</span>
              </label>
              <p className="text-xs text-[var(--muted)]">{transcription ? t("classroomSettings.transcribeNote") : t("classroomSettings.transcribeUnavailable")}</p>
            </div>
          </div>
        ) : (
          <>
            <input type="hidden" name="cameras" value={current.cameras ? "video" : "audio"} />
            {current.transcribe ? <input type="hidden" name="transcribe" value="on" /> : null}
          </>
        )}

        <div className="space-y-4 border-t border-[var(--border)] pt-4">
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
          <label className="flex flex-wrap items-center gap-2">
            <span>{t("classroomSettings.target")}</span>
            <input
              name="attendanceTarget"
              type="number"
              min={1}
              max={100}
              step={1}
              defaultValue={current.attendanceTarget ?? ""}
              className="w-20 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 tabular-nums"
            />
            <span>{t("classroomSettings.targetAfter")}</span>
          </label>
        </div>
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
