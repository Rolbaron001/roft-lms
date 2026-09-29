"use client";

import { useActionState, useState } from "react";
import { BadgeMedal } from "@/components/badge-medal";
import { BADGE_SHAPES, type BadgeShape } from "@/lib/badge-shapes";
import { defineBadgeAction, type BadgeFormState } from "./actions";
import { useT } from "@/components/i18n";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type BadgeTarget = { value: string; label: string; group: string };

/**
 * Designing a badge, with the badge on screen while it is designed.
 *
 * The preview is the point. Everything here is two colours, a shape and a
 * character, which is easy to choose badly and impossible to judge from four
 * form fields - so the medal updates as it is typed and the decision is made by
 * looking rather than by imagining.
 *
 * What earns it is one select rather than a kind plus a target, so the
 * inconsistent combination cannot be expressed. Options are grouped by what
 * they are, and the tenant-wide fallback sits first because a provider who
 * wants one badge should not have to work out that it is the thing called
 * "default" at the bottom of a list of courses.
 */
export function BadgeDesigner({ targets }: { targets: BadgeTarget[] }) {
  const t = useT();
  const [state, action, saving] = useActionState<BadgeFormState, FormData>(
    defineBadgeAction,
    {},
  );

  const kept = state.values ?? {};
  const [glyph, setGlyph] = useState(kept.glyph || "★");
  const [shape, setShape] = useState<BadgeShape>(
    (kept.shape as BadgeShape) || "circle",
  );
  const [background, setBackground] = useState(kept.background || "#4C1D95");
  const [ink, setInk] = useState(kept.ink || "#FFFFFF");

  const groups = [...new Set(targets.map((target) => target.group))];

  return (
    // Keyed on the attempt so a refused submission remounts with the values it
    // was given back, rather than the empty form React would otherwise reset to.
    <form key={state.attempt ?? 0} action={action} className="space-y-4">
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col items-center gap-2">
          <BadgeMedal
            glyph={glyph}
            shape={shape}
            background={background}
            ink={ink}
            size={96}
          />
          <span className="text-xs text-[var(--muted)]">{t("badges.appear")}</span>
        </div>

        <div className="min-w-[16rem] flex-1 space-y-3">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">{t("badges.name")}</span>
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={kept.name}
              placeholder={t("badges.nameHint")}
              className={`${inputClass} mt-1 block w-full`}
            />
          </label>

          <label className="block text-sm">
            <span className="text-[var(--muted)]">{t("badges.earns")}</span>
            <select
              name="target"
              required
              defaultValue={kept.target}
              className={`${inputClass} mt-1 block w-full`}
            >
              <option value="">{t("badges.chooseOne")}</option>
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {targets
                    .filter((target) => target.group === group)
                    .map((target) => (
                      <option key={target.value} value={target.value}>
                        {target.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("badges.symbol")}</span>
          <input
            name="glyph"
            value={glyph}
            onChange={(event) => setGlyph(event.target.value.slice(0, 8))}
            maxLength={8}
            className={`${inputClass} mt-1 block w-full text-center text-lg`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("badges.shape")}</span>
          <select
            name="shape"
            value={shape}
            onChange={(event) => setShape(event.target.value as BadgeShape)}
            className={`${inputClass} mt-1 block w-full`}
          >
            {BADGE_SHAPES.map((option) => (
              <option key={option} value={option}>
                {t(`badges.shape.${option}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("badges.background")}</span>
          <input
            name="background"
            type="color"
            value={background}
            onChange={(event) => setBackground(event.target.value)}
            className={`${inputClass} mt-1 block h-9 w-full p-1`}
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">{t("badges.ink")}</span>
          <input
            name="ink"
            type="color"
            value={ink}
            onChange={(event) => setInk(event.target.value)}
            className={`${inputClass} mt-1 block h-9 w-full p-1`}
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-[var(--muted)]">{t("badges.says")}</span>
        <textarea
          name="description"
          rows={2}
          maxLength={500}
          defaultValue={kept.description}
          placeholder={t("badges.saysHint")}
          className={`${inputClass} mt-1 block w-full`}
        />
      </label>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {saving ? t("common.saving") : t("badges.create")}
      </button>
    </form>
  );
}
