"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "./i18n";

/** Where the folder import leaves its summary for the qualification page. */
export const IMPORT_NOTICE_KEY = "roft:import-notice:";

const noChange = () => () => {};

/**
 * What the folder import just did, at the top of the qualification it opened
 * on (Roland, 19 November 2026). Shown once, in this tab; closed with a click.
 */
export function ImportNotice({ qualificationId }: { qualificationId: string }) {
  const t = useT();
  const key = `${IMPORT_NOTICE_KEY}${qualificationId}`;
  const stored = useSyncExternalStore(
    noChange,
    () => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const [closed, setClosed] = useState(false);

  // Once shown, it is not shown again on the next visit.
  useEffect(() => {
    if (!stored) return;
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* nothing to clear */
    }
  }, [key, stored]);

  if (!stored || closed) return null;
  return (
    <div role="status" className="mb-4 rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">{stored}</p>
        <button type="button" onClick={() => setClosed(true)} className="shrink-0 text-sm text-[var(--muted)] hover:underline">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
