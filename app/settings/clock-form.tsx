"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui";
import {
  clockInZone,
  supportedTimeZones,
  viewerTimeZone,
  zoneLabel,
} from "@/lib/timezone";
import { updateClockAction, type ClockState } from "./actions";
import { useT } from "@/components/i18n";

/**
 * The provider's own clock.
 *
 * Worth a section of its own rather than a line in branding, because it is the
 * one setting that decides whether a candidate is admitted to a sitting. Every
 * timetabled time in the platform means this clock: a lecture at 18:30 is
 * 18:30 here, and an admission cut-off is judged against it.
 */
export function ClockForm({ current }: { current: string }) {
  // Keyed on the saved value so that a save re-mounts the form and the picker
  // re-reads it. Without this the local selection outlives the round trip, and
  // a form that shows one zone while the record holds another is worse than no
  // form: somebody scheduling against it would be an hour out and confident.
  return <ClockFields key={current} current={current} />;
}

function ClockFields({ current }: { current: string }) {
  const t = useT();
  const [state, action, saving] = useActionState<ClockState, FormData>(
    updateClockAction,
    {},
  );
  const [chosen, setChosen] = useState(current);

  const now = new Date();
  const zones = supportedTimeZones();
  const viewer = viewerTimeZone();

  // Shown live as they pick, because "Africa/Johannesburg" tells somebody far
  // less than the fact that it is currently ten past four there.
  let preview: string | null = null;
  try {
    preview = `${clockInZone(now, chosen)} ${zoneLabel(chosen, now)}`;
  } catch {
    preview = null;
  }

  return (
    <Card title={t("clock.title")} description={t("clock.note")}>
      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="timezone" className="block text-sm font-medium">
            {t("clock.zone")}
          </label>
          <select
            id="timezone"
            name="timezone"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
            className="mt-1 w-full max-w-sm rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          {preview ? (
            <p className="mt-2 text-sm text-[var(--muted)] tabular-nums">
              {t("clock.now", { time: preview })}
              {viewer && viewer !== chosen
                ? ` ${t("clock.yours", { time: `${clockInZone(now, viewer)} ${zoneLabel(viewer, now)}` })}`
                : null}
            </p>
          ) : null}
        </div>

        <p className="max-w-2xl text-xs text-[var(--muted)]">{t("clock.both")}</p>

        {state.error ? (
          <p className="text-sm text-[var(--danger,#b00020)]">{state.error}</p>
        ) : null}
        {state.notice ? (
          <p className="text-sm text-[var(--muted)]">{state.notice}</p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </Card>
  );
}
