"use client";

import { useState, useTransition } from "react";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";
import type { MapAnswer, MapItem, ProgrammeMap } from "@/lib/programme-map";
import { mapAnswerAction } from "../actions";

/**
 * "Check the map" (job sheet D60; Roland, 24 November 2026): "very user
 * friendly ... clear and guided ... work through it very quickly, else it
 * becomes a burden. Ticks and checkboxes."
 *
 * Three groups, in the order they need attention. What the platform could
 * not decide is asked as one plain question with its answers as buttons, and
 * saved the moment one is chosen. What it decided less surely is a line with
 * a tick box, and "Tick all" clears the lot. What it is sure of is folded
 * away by study unit, each line with a Change. Nothing here is typed.
 */

const KIND_CHOICES = ["theory_guide", "workbook", "workbook_memorandum", "summative_assessment", "summative_memorandum", "learner_handbook", "learning_programme_guide"] as const;

export function CheckTheMap({ jobId, map, live }: { jobId: string; map: ProgrammeMap; live: boolean }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (answer: MapAnswer | "all") =>
    start(async () => {
      const result = await mapAnswerAction(jobId, answer);
      setError(result.error ?? null);
    });

  const decide = map.items.filter((item) => item.state === "decide");
  const look = map.items.filter((item) => item.state === "look");
  const settled = map.items.filter((item) => item.state === "settled");
  const total = map.items.length;
  const done = settled.length;

  return (
    <section aria-labelledby="map-heading" className={`space-y-4 ${pending ? "opacity-70" : ""}`}>
      <div>
        <h3 id="map-heading" className="text-base font-semibold">{t("map.title")}</h3>
        <p className="text-sm text-[var(--muted)]">{t("map.intro")}</p>
      </div>

      {/* Where it stands, in three counts and one bar. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Count tone="danger" count={decide.length} label={t("map.needYou")} />
        <Count tone="warning" count={look.length} label={t("map.toGlance")} />
        <Count tone="success" count={settled.length} label={t("map.settled")} />
        <div className="ml-auto h-2 w-40 rounded-full bg-[var(--border)]" aria-hidden>
          <div className="h-2 rounded-full bg-[var(--success)]" style={{ width: `${total ? Math.round((done / total) * 100) : 100}%` }} />
        </div>
      </div>
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      {/* 1. What needs an answer: one question each. */}
      {decide.length > 0 ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-[var(--danger)]">{t("map.needYouHeading", { count: decide.length })}</h4>
          {decide.map((item) => (
            <Question key={item.path} item={item} units={map.units} live={live} save={save} />
          ))}
        </div>
      ) : null}

      {/* 2. What is worth a glance: a tick each, or all at once. */}
      {look.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{t("map.glanceHeading", { count: look.length })}</h4>
            {live ? (
              <button type="button" onClick={() => save("all")} className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-medium text-white">
                {t("map.tickAll")}
              </button>
            ) : null}
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {look.map((item) => (
              <Line key={item.path} item={item} units={map.units} live={live} save={save} tickable />
            ))}
          </ul>
        </div>
      ) : null}

      {/* 3. What is settled, folded away by study unit. */}
      {settled.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-[var(--success)]">{t("map.settledHeading", { count: settled.length })}</h4>
          {groups(settled, map.units, t).map((group) => (
            <details key={group.key} className="rounded-md border border-[var(--border)]">
              <summary className="cursor-pointer px-3 py-2 text-sm">
                <span className="font-medium">{group.label}</span> <span className="text-[var(--muted)]">· {t("map.files", { count: group.items.length })}</span>
              </summary>
              <ul className="divide-y divide-[var(--border)] px-3 pb-2">
                {group.items.map((item) => (
                  <Line key={item.path} item={item} units={map.units} live={live} save={save} />
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : null}

      {map.ready ? (
        <p className="rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 px-3 py-2 text-sm font-medium">{t("map.ready")}</p>
      ) : (
        <p className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-sm">
          {t("map.notReady", { decide: decide.length, look: look.length })}
        </p>
      )}
    </section>
  );
}

function Count({ tone, count, label }: { tone: "danger" | "warning" | "success"; count: number; label: string }) {
  const colour = tone === "danger" ? "var(--danger)" : tone === "warning" ? "#b45309" : "var(--success)";
  return (
    <span className="rounded-full border px-3 py-1" style={{ borderColor: colour, color: colour, opacity: count === 0 && tone !== "success" ? 0.5 : 1 }}>
      <span className="font-semibold tabular-nums">{count}</span> {label}
    </span>
  );
}

/** Settled items grouped by study unit, then the qualification's own, then the rest. */
function groups(items: MapItem[], units: ProgrammeMap["units"], t: ReturnType<typeof useT>) {
  const out: { key: string; label: string; items: MapItem[] }[] = [];
  for (const unit of units) {
    const inUnit = items.filter((item) => item.unit === unit.code && item.role !== "ignored" && item.role !== "library");
    if (inUnit.length > 0) out.push({ key: unit.code, label: `${unit.code} ${unit.title !== unit.code ? unit.title : ""}`.trim(), items: inUnit });
  }
  const placed = new Set(out.flatMap((group) => group.items));
  const programme = items.filter((item) => !placed.has(item) && item.role !== "ignored" && item.role !== "library");
  if (programme.length > 0) out.push({ key: "programme", label: t("map.group.programme"), items: programme });
  const library = items.filter((item) => item.role === "library");
  if (library.length > 0) out.push({ key: "library", label: t("map.group.library"), items: library });
  const ignored = items.filter((item) => item.role === "ignored");
  if (ignored.length > 0) out.push({ key: "ignored", label: t("map.group.leftOut"), items: ignored });
  return out;
}

/** One plain question, its answers as buttons, saved when one is chosen. */
function Question({ item, units, live, save }: { item: MapItem; units: ProgrammeMap["units"]; live: boolean; save: (answer: MapAnswer) => void }) {
  const t = useT();
  const options: { label: string; answer: MapAnswer }[] =
    item.question === "what"
      ? [
          ...KIND_CHOICES.map((kind) => ({ label: maybe(t, `docKind.${kind}`) ?? kind, answer: { path: item.path, field: "kind", value: kind } as MapAnswer })),
          { label: t("map.leaveOut"), answer: { path: item.path, field: "ignore" } },
        ]
      : item.question === "unit"
        ? units.map((unit) => ({ label: `${unit.code} ${unit.title !== unit.code ? unit.title : ""}`.trim(), answer: { path: item.path, field: "unit", value: unit.code } as MapAnswer }))
        : item.question === "guide"
          ? [
              ...item.choices.map((choice) => ({ label: choice.title, answer: { path: item.path, field: "guide", value: choice.path } as MapAnswer })),
              { label: t("map.noGuide"), answer: { path: item.path, field: "guide", value: "none" } },
            ]
          : [
              ...item.choices.map((choice) => ({ label: choice.title, answer: { path: item.path, field: "paper", value: choice.path } as MapAnswer })),
              { label: t("map.leaveOut"), answer: { path: item.path, field: "paper", value: "ignore" } },
            ];

  return (
    <div className="rounded-lg border-2 border-[var(--danger)]/40 bg-[var(--surface)] p-3">
      <p className="text-sm font-medium">{item.title}</p>
      <p className="text-xs text-[var(--muted)]">{summaryOf(item, t)}</p>
      <p className="mt-2 text-sm font-semibold">{t(`map.ask.${item.question ?? "what"}`)}</p>
      {item.why ? <p className="text-xs text-[var(--muted)]">{item.why}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={!live}
            onClick={() => save(option.answer)}
            className="min-h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-left text-sm hover:border-[var(--brand-primary)] disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Workbook · SU2 · also SU1 · guide: Assessor Guide 1". */
function summaryOf(item: MapItem, t: ReturnType<typeof useT>): string {
  const parts = [maybe(t, `docKind.${item.kind}`) ?? item.kind ?? ""];
  if (item.unit) parts.push(item.unit);
  if (item.also.length > 0) parts.push(t("map.alsoCovers", { units: item.also.join(", ") }));
  if (item.role === "paper") parts.push(item.guide ? t("map.guideIs", { title: item.guide.title }) : item.noGuide ? t("map.noGuide") : "");
  if (item.role === "guide" && item.guides.length > 0) parts.push(t("map.guides", { titles: item.guides.join(", ") }));
  return parts.filter(Boolean).join(" · ");
}

/** A line: what it is and where it goes, a tick where it wants one, and Change. */
function Line({
  item,
  units,
  live,
  save,
  tickable = false,
}: {
  item: MapItem;
  units: ProgrammeMap["units"];
  live: boolean;
  save: (answer: MapAnswer) => void;
  tickable?: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-2 text-sm">
      <div className="flex items-start gap-2">
        {tickable ? (
          <input
            type="checkbox"
            aria-label={t("map.looksRight")}
            disabled={!live}
            onChange={(event) => save({ path: item.path, field: "confirm", value: event.target.checked })}
            className="mt-1 h-4 w-4"
          />
        ) : (
          <span aria-hidden className="mt-0.5 text-[var(--success)]">✓</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{item.title}</p>
          <p className="text-xs text-[var(--muted)]">{summaryOf(item, t)}</p>
          {tickable && item.why ? <p className="text-xs text-amber-700">{item.why}</p> : null}
        </div>
        {live && item.role !== "library" ? (
          <button type="button" onClick={() => setEditing(!editing)} className="shrink-0 text-xs underline underline-offset-2">
            {editing ? t("map.done") : t("map.change")}
          </button>
        ) : null}
      </div>
      {editing ? <Editor item={item} units={units} save={save} /> : null}
    </li>
  );
}

/** Changing a settled or glanced line: its unit, the other units it covers, its guide. */
function Editor({ item, units, save }: { item: MapItem; units: ProgrammeMap["units"]; save: (answer: MapAnswer) => void }) {
  const t = useT();
  const field = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm";
  return (
    <div className="mt-2 space-y-2 rounded-md border border-[var(--border)] p-2 pl-8">
      {units.length > 0 && item.role !== "ignored" ? (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">{t("map.studyUnit")}</span>
          <select className={field} value={item.unit ?? ""} onChange={(event) => save({ path: item.path, field: "unit", value: event.target.value })}>
            {!item.unit ? <option value="">{t("map.none")}</option> : null}
            {units.map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.code} {unit.title !== unit.code ? unit.title : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {units.length > 1 && item.unit ? (
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="mb-1 text-xs text-[var(--muted)]">{t("map.alsoLegend")}</legend>
          {units
            .filter((unit) => unit.code !== item.unit)
            .map((unit) => (
              <label key={unit.code} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={item.also.includes(unit.code)}
                  onChange={(event) =>
                    save({
                      path: item.path,
                      field: "also",
                      value: event.target.checked ? [...item.also, unit.code] : item.also.filter((code) => code !== unit.code),
                    })
                  }
                />
                {unit.code}
              </label>
            ))}
        </fieldset>
      ) : null}
      {item.role === "paper" ? (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">{t("map.guide")}</span>
          <select
            className={field}
            value={item.guide?.path ?? (item.noGuide ? "none" : "")}
            onChange={(event) => save({ path: item.path, field: "guide", value: event.target.value })}
          >
            {!item.guide && !item.noGuide ? <option value="">{t("map.none")}</option> : null}
            {item.choices.map((choice) => (
              <option key={choice.path} value={choice.path}>
                {choice.title}
              </option>
            ))}
            <option value="none">{t("map.noGuide")}</option>
          </select>
        </label>
      ) : null}
      {item.role !== "ignored" ? (
        <button type="button" onClick={() => save({ path: item.path, field: "ignore" })} className="text-xs text-[var(--danger)] underline underline-offset-2">
          {t("map.leaveOut")}
        </button>
      ) : null}
    </div>
  );
}
