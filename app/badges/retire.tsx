"use client";

import { useActionState } from "react";
import { retireBadgeAction, type BadgeFormState } from "./actions";
import { useT } from "@/components/i18n";

/**
 * Retiring a badge.
 *
 * Says "retire" rather than "delete" on the button, because that is what it
 * does: nobody new earns it and everybody holding it keeps it. A learner may
 * have shown this badge to an employer, and a definition that vanished would
 * turn their verification page into "no such badge".
 */
export function RetireBadge({
  badgeId,
  name,
}: {
  badgeId: string;
  name: string;
}) {
  const t = useT();
  const [state, action, saving] = useActionState<BadgeFormState, FormData>(
    retireBadgeAction,
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="badgeId" value={badgeId} />
      <button
        type="submit"
        disabled={saving}
        title={t("badges.retireTitle", { name })}
        className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-60"
      >
        {saving ? t("badges.retiring") : t("badges.retire")}
      </button>
      {state.error ? (
        <p className="mt-1 text-xs text-[var(--danger)]">{state.error}</p>
      ) : null}
    </form>
  );
}
