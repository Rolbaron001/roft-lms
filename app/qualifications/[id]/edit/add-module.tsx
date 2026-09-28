"use client";

import { useActionState } from "react";
import { addModuleAction, type EditorState } from "./actions";
import { useT } from "@/components/i18n";

const COMPONENTS = ["knowledge", "practical", "workplace", "general"] as const;

/**
 * Adding a module.
 *
 * The component choice is what everything else follows from — it decides which
 * kinds of line the topics can hold, and whether the module is evidenced by
 * assessment criteria or by a signed logbook. So it is asked first, in words
 * rather than in codes, and the note underneath says what the choice means.
 */
export function AddModule({ qualificationId }: { qualificationId: string }) {
  const t = useT();
  const [state, act, pending] = useActionState<EditorState, FormData>(
    addModuleAction,
    {},
  );

  return (
    <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold">{t("addModule.title")}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t("addModule.note")}</p>

      <form action={act} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="qualificationId" value={qualificationId} />

        <label className="text-xs text-[var(--muted)]">
          {t("addModule.kind")}
          <select
            name="component"
            defaultValue="knowledge"
            className="mt-1 block rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          >
            {COMPONENTS.map((value) => (
              <option key={value} value={value}>
                {t(`qualPage.componentModule.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-[var(--muted)]">
          {t("addModule.code")}
          <input
            name="code"
            required
            placeholder="121150-KM-01"
            className="mt-1 block w-44 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-sm"
          />
        </label>

        <label className="flex-1 text-xs text-[var(--muted)]">
          {t("addModule.name")}
          <input
            name="title"
            required
            placeholder={t("addModule.nameHint")}
            className="mt-1 block w-full min-w-48 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          />
        </label>

        <label className="text-xs text-[var(--muted)]">
          {t("addModule.credits")}
          <input
            name="credits"
            type="number"
            min={0}
            className="mt-1 block w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? t("addModule.adding") : t("addModule.add")}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="mt-2 text-xs text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
