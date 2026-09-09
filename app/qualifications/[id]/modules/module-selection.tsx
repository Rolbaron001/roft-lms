"use client";

import { useActionState, useState } from "react";
import { selectModulesAction, type ActionState } from "./actions";

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge",
  practical: "Practical skill",
  workplace: "Workplace experience",
  general: "General",
};

const COMPONENT_ORDER = ["knowledge", "practical", "workplace", "general"];

type Module = {
  id: string;
  code: string;
  title: string;
  component: string;
  credits: number | null;
};

/**
 * The credit arithmetic, as it is ticked.
 *
 * SAQA 118710 states 47 minimum credits and lists modules totalling 16 + 14 +
 * 17. The two agreeing is the only check available that the right modules were
 * ticked - the codes alone would not catch a mis-read line - so the running
 * total is shown next to the claim rather than validated on save.
 *
 * It is a comparison, not a rule. These documents are known to contradict
 * themselves: the Commercial Cleaner curriculum gives one module four credits
 * in its summary and twelve in its own specification. Refusing to save would
 * make the platform unable to hold what the document actually says.
 */
export function ModuleSelection({
  qualificationId,
  modules,
  chosen,
  claimedCredits,
}: {
  qualificationId: string;
  modules: Module[];
  chosen: string[];
  claimedCredits: number | null;
}) {
  const [state, action, saving] = useActionState<ActionState, FormData>(
    selectModulesAction,
    {},
  );

  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set(chosen));

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const perComponent = new Map<string, number>();
  let running = 0;

  for (const row of modules) {
    if (!ticked.has(row.id)) continue;
    const credits = row.credits ?? 0;
    running += credits;
    perComponent.set(
      row.component,
      (perComponent.get(row.component) ?? 0) + credits,
    );
  }

  const agrees = claimedCredits === null || claimedCredits === running;

  const grouped = COMPONENT_ORDER.map((component) => ({
    component,
    modules: modules.filter((module) => module.component === component),
  })).filter((group) => group.modules.length > 0);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="qualificationId" value={qualificationId} />

      {grouped.map((group) => (
        <section
          key={group.component}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              {COMPONENT_LABELS[group.component] ?? group.component}
            </h2>
            <span className="text-xs text-[var(--muted)]">
              {perComponent.get(group.component) ?? 0} credits chosen
            </span>
          </div>

          <ul className="mt-3 space-y-1">
            {group.modules.map((module) => (
              <li key={module.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-[var(--background)]">
                  <input
                    type="checkbox"
                    name="moduleId"
                    value={module.id}
                    checked={ticked.has(module.id)}
                    onChange={() => toggle(module.id)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    <span className="font-medium">{module.code}</span>{" "}
                    {module.title}
                    <span className="block text-xs text-[var(--muted)]">
                      {module.credits === null
                        ? "No credits recorded"
                        : `${module.credits} credits`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section
        className={`rounded-lg border p-5 ${
          agrees
            ? "border-[var(--border)] bg-[var(--surface)]"
            : "border-[var(--warning,var(--danger))]/40 bg-[var(--danger)]/5"
        }`}
      >
        <p className="text-sm">
          <span className="font-medium">
            {running} credits chosen
            {claimedCredits === null
              ? ""
              : ` · ${claimedCredits} claimed on the document`}
          </span>
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {claimedCredits === null
            ? "No credit total is recorded for this qualification, so there is nothing to check against. Its SAQA document states one under Minimum Credits."
            : agrees
              ? "These agree, which is the sign the right modules are ticked."
              : "These do not agree. Either a module is ticked that the SAQA document does not list, or one it lists is missing, or the credits on a module were read in wrongly. Worth checking before saving — but the platform will save what you tell it."}
        </p>
      </section>

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
        disabled={saving}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {saving ? "Saving…" : "Save which modules this takes"}
      </button>
    </form>
  );
}
