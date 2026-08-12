"use client";

import { markAllReadAction } from "./actions";

export function MarkAllRead() {
  return (
    <form action={markAllReadAction}>
      <button
        type="submit"
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium"
      >
        Mark all as read
      </button>
    </form>
  );
}
