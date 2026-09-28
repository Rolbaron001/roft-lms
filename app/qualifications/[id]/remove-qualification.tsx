"use client";

import { useActionState, useState } from "react";
import { removeQualificationAction, type RemoveState } from "./remove-actions";
import { useT } from "@/components/i18n";
import { Rich } from "@/components/rich-text";

/**
 * Removing a qualification, or being told why not.
 *
 * Roland, 20 September: "There must be functionality to delete a
 * qualification... it shouldn't be possible if learners have completed the
 * qualification or if cohorts have been run against the qualification, for
 * record purposes. But, in cases where the qualification has never been used,
 * it should be possible to delete it."
 *
 * Both halves are on the screen. Where something has happened, the reasons are
 * listed by name and there is no control at all - a disabled button invites
 * somebody to go and find out how to enable it, and this is not a permission
 * problem to be worked around. Where nothing has, what would go is counted
 * first, because "and everything under it" is not a quantity anybody can
 * weigh.
 */
export function RemoveQualification({
  qualificationId,
  title,
  holds,
  removes,
}: {
  qualificationId: string;
  title: string;
  /** Why it may not be removed. Empty means it may. */
  holds: { what: string; count: number }[];
  /** What would go with it. */
  removes: { what: string; count: number }[];
}) {
  const t = useT();
  const [state, action, working] = useActionState<RemoveState, FormData>(removeQualificationAction, {});
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (holds.length > 0) {
    return (
      <section className="mt-8 rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm font-medium">{t("removeQual.cannot")}</p>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("removeQual.cannotWhy")}</p>
        <ul className="mt-2 space-y-0.5 text-sm">
          {holds.map((hold) => (
            <li key={hold.what}>
              <span className="font-medium tabular-nums">{hold.count}</span>{" "}
              <span className="text-[var(--muted)]">{hold.what}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const listed = removes.map((row) => `${row.count} ${row.what}`);
  const items =
    listed.length > 1
      ? `${listed.slice(0, -1).join(", ")}${t("removeQual.and")}${listed[listed.length - 1]}`
      : (listed[0] ?? "");

  return (
    <section
      className="mt-8 rounded-lg border p-4"
      style={{ borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)" }}
    >
      <p className="text-sm font-medium">{t("removeQual.title")}</p>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("removeQual.canWhy")}</p>

      {removes.length > 0 ? (
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{t("removeQual.wouldTake", { items })}</p>
      ) : null}

      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      {open ? (
        <form action={action} className="mt-3 space-y-2">
          <input type="hidden" name="qualificationId" value={qualificationId} />
          <input type="hidden" name="title" value={title} />

          <label className="block max-w-xl text-sm">
            <span className="text-[var(--muted)]">
              <Rich text={t("removeQual.typeTitle")} parts={{ title: <span className="font-medium">{title}</span> }} />
            </span>
            <input
              name="confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={working || typed !== title}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--danger)" }}
            >
              {working ? t("removeQual.removing") : t("removeQual.remove")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
              }}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {t("removeQual.start")}
        </button>
      )}
    </section>
  );
}
