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
  let notice = stored;
  let attention = false;
  try {
    const parsed = JSON.parse(stored) as { notice: string; attention: boolean };
    notice = parsed.notice;
    attention = parsed.attention;
  } catch {
    /* plain text */
  }
  // Light red when it holds something to act on: a warning shaded green is
  // not read (Roland, 19 November 2026).
  const tone = attention ? "border-[var(--danger)]/40 bg-[var(--danger)]/5" : "border-[var(--success)]/40 bg-[var(--success)]/5";
  return (
    <div role={attention ? "alert" : "status"} className={`mb-4 rounded-md border p-3 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">{notice}</p>
        <button type="button" onClick={() => setClosed(true)} className="shrink-0 text-sm text-[var(--muted)] hover:underline">
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
