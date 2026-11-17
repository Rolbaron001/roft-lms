"use client";

import { useActionState, useRef, useEffect } from "react";
import { useT } from "@/components/i18n";
import { postAnnouncementAction, type AnnounceState } from "./announce-actions";

/** Writing an announcement to the cohort (job sheet D52 (1)). */
export function AnnounceForm({ cohortId }: { cohortId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<AnnounceState, FormData>(postAnnouncementAction, {});
  const form = useRef<HTMLFormElement>(null);
  // Cleared once posted, so the same words are not sent twice by a second press.
  useEffect(() => {
    if (state.notice) form.current?.reset();
  }, [state.notice]);

  const field = "mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm";
  return (
    <form ref={form} action={action} className="max-w-2xl space-y-3">
      <input type="hidden" name="cohortId" value={cohortId} />
      <label className="block text-sm">
        <span className="font-medium">{t("announce.subject")}</span>
        <input name="subject" required minLength={3} maxLength={150} className={field} />
      </label>
      <label className="block text-sm">
        <span className="font-medium">{t("announce.body")}</span>
        <textarea name="body" required rows={5} maxLength={5000} className={field} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="email" defaultChecked />
        {t("announce.email")}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {pending ? t("announce.posting") : t("announce.post")}
        </button>
        {state.notice ? <p className="text-sm text-[var(--success)]">{state.notice}</p> : null}
        {state.error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
