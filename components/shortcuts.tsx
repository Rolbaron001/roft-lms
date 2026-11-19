"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import type { NavGroup } from "./nav-menu";
import { RECENT_KEY } from "./shell-nav";
import { useT } from "./i18n";

type Shortcut = { href: string; label: string };

const MOST = 4;

function readStored(): string {
  try {
    return window.localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    // Storage refused: the fixed shortcuts still show.
    return "[]";
  }
}

function subscribe(changed: () => void) {
  window.addEventListener("storage", changed);
  return () => window.removeEventListener("storage", changed);
}

/**
 * Home's shortcuts, in a pane of their own (Roland, 19 November 2026).
 *
 * The first few are the ones the platform offers this person by their roles
 * (an administrator: a new cohort, adding people, loading a qualification).
 * After them come the pages this person has been using, from the same record
 * of recently opened pages that Find a page keeps in this browser, so
 * somebody who has just been working on skills programmes finds Skills
 * programmes here next time. Only pages the menu offers them can appear.
 */
export function Shortcuts({ fixed, groups }: { fixed: (Shortcut & { primary?: boolean })[]; groups: NavGroup[] }) {
  const t = useT();
  // Read from this browser's storage; the server renders none, and they appear once the page is in the browser.
  const stored = useSyncExternalStore(subscribe, readStored, () => "[]");
  const recent = useMemo(() => {
    try {
      const hrefs = JSON.parse(stored) as string[];
      const entries = groups.flatMap((group) => group.items);
      const taken = new Set(fixed.map((one) => one.href));
      return hrefs
        .filter((href) => href !== "/" && !taken.has(href))
        .map((href) => entries.find((entry) => entry.href === href))
        .filter((entry): entry is Shortcut => Boolean(entry))
        .slice(0, MOST);
    } catch {
      return [];
    }
  }, [stored, fixed, groups]);

  if (fixed.length === 0 && recent.length === 0) return null;

  const button = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold transition hover:border-[var(--brand-accent)]";
  return (
    <section aria-label={t("shortcuts.title")} className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("shortcuts.title")}</h2>
      <div className="flex flex-wrap gap-2">
        {fixed.map((one) => (
          <Link
            key={one.href}
            href={one.href}
            className={one.primary ? "rounded-md px-4 py-2.5 text-sm font-semibold text-white" : button}
            style={one.primary ? { background: "var(--brand-primary)" } : undefined}
          >
            {one.label}
          </Link>
        ))}
        {recent.length > 0 && fixed.length > 0 ? <span aria-hidden className="mx-1 self-stretch border-l border-[var(--border)]" /> : null}
        {recent.map((one) => (
          <Link key={one.href} href={one.href} className={button} title={t("shortcuts.recent")}>
            {one.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
