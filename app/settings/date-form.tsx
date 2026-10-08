"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui";
import { useDates, useT } from "@/components/i18n";
import { DATE_STYLES, dateWriter, type DateStyle } from "@/lib/date-format";
import { updateDateStyleAction, type ClockState } from "./actions";

/**
 * How dates are written across the platform (Roland, 8 October 2026: "Like
 * Clock, please add a Date setting under Settings"). Each choice shows today's
 * date written that way, so nobody has to imagine what a pattern means.
 */
export function DateForm({ current, timeZone, device }: { current: DateStyle; timeZone: string; device: string | null }) {
  return <DateFields key={current} current={current} timeZone={timeZone} device={device} />;
}

/**
 * `device` is the regional setting the server read from this browser, the
 * same one every page uses, so the preview shows exactly what the pages will.
 */
function DateFields({ current, timeZone, device }: { current: DateStyle; timeZone: string; device: string | null }) {
  const t = useT();
  const language = useDates();
  const [state, action, saving] = useActionState<ClockState, FormData>(updateDateStyleAction, {});
  const [chosen, setChosen] = useState<DateStyle>(current);
  const today = new Date();

  return (
    <Card title={t("dateStyle.title")} description={t("dateStyle.note")}>
      <form action={action} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">{t("dateStyle.title")}</legend>
          {DATE_STYLES.map((style) => (
            <label key={style} className="flex items-baseline gap-2 text-sm">
              <input type="radio" name="dateStyle" value={style} checked={chosen === style} onChange={() => setChosen(style)} />
              <span>
                <span className="font-medium">{t(`dateStyle.option.${style}`)}</span>
                <span className="ml-2 text-[var(--muted)] tabular-nums">
                  {dateWriter(style, language, device, timeZone).day(today)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {chosen === "device" ? <p className="text-sm text-[var(--muted)]">{t("dateStyle.deviceNote")}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || chosen === current}
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
