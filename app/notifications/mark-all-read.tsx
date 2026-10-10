"use client";

import { markAllReadAction } from "./actions";
import { useT } from "@/components/i18n";

export function MarkAllRead() {
  const t = useT();
  return (
    <form action={markAllReadAction} data-own-sitting>
      <button
        type="submit"
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium"
      >
        {t("notify.markAll")}
      </button>
    </form>
  );
}
