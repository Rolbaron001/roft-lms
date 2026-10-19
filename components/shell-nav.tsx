"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NavGroup, NavLink } from "./nav-menu";
import { useT } from "./i18n";

/**
 * Finding your way on a small screen (Cecilia and Heidi, 19 October 2026: the
 * menu "consumes significant space on standard 13-inch laptop screens", and
 * on a phone it wrapped onto several lines).
 *
 * Three things, each answering a different way of looking for a page:
 *
 *   - **Find a page** (Ctrl+K, or the magnifier): type a few letters of what
 *     you want. Nobody has to know which heading a page is filed under.
 *   - **Recently opened**: the pages this person last used, kept in this
 *     browser, offered first. Most days are spent on four or five pages.
 *   - **Menu** on a phone or tablet: one button opening a full-height panel,
 *     with each heading folded until it is opened.
 */

const RECENT_KEY = "roft:recent-pages";
const RECENT_MAX = 5;

type Entry = NavLink & { group: string | null };

function flatten(groups: NavGroup[]): Entry[] {
  return groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
}

function isCurrent(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The menu entry a page falls under: the longest href it sits beneath. */
function entryFor(entries: Entry[], pathname: string): Entry | null {
  return (
    entries
      .filter((entry) => isCurrent(entry.href, pathname))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}

function readRecent(entries: Entry[]): Entry[] {
  try {
    const hrefs = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    return hrefs.map((href) => entries.find((entry) => entry.href === href)).filter((entry): entry is Entry => Boolean(entry));
  } catch {
    // Storage refused: nothing is remembered, and nothing breaks.
    return [];
  }
}

/** Remembers the menu entry of each page opened, most recent first. */
function useRememberPage(entries: Entry[]) {
  const pathname = usePathname();
  useEffect(() => {
    const entry = entryFor(entries, pathname);
    if (!entry || entry.href === "/") return;
    try {
      const hrefs = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
      const next = [entry.href, ...hrefs.filter((href) => href !== entry.href)].slice(0, RECENT_MAX);
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // As above.
    }
  }, [entries, pathname]);
}

/** Letters in order, so "eisr" finds "EISA readiness" and "tmp" finds "Templates". */
function matches(entry: Entry, query: string): boolean {
  const haystack = `${entry.label} ${entry.group ?? ""}`.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (needle === "") return true;
  if (haystack.includes(needle)) return true;
  let at = 0;
  for (const letter of needle.replace(/\s+/g, "")) {
    at = haystack.indexOf(letter, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

function SearchIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M13 13l4 4" strokeLinecap="round" />
    </svg>
  );
}

/** The magnifier in the header, and the dialog it opens. */
export function FindPage({ groups }: { groups: NavGroup[] }) {
  const t = useT();
  const router = useRouter();
  const entries = useMemo(() => flatten(groups), [groups]);
  useRememberPage(entries);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Entry[]>([]);
  const input = useRef<HTMLInputElement>(null);

  function show() {
    setRecent(readRecent(entries));
    setQuery("");
    setActive(0);
    setOpen(true);
  }

  // Ctrl+K anywhere, or "/" when not typing in a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if ((event.key === "k" && (event.ctrlKey || event.metaKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setRecent(readRecent(entries));
        setQuery("");
        setActive(0);
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [entries]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const found = query.trim() === "" ? [...recent, ...entries.filter((entry) => !recent.includes(entry))] : entries.filter((entry) => matches(entry, query));

  function go(entry: Entry | undefined) {
    if (!entry) return;
    setOpen(false);
    router.push(entry.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        title={t("shell.findShortcut")}
        aria-label={t("shell.find")}
        className="inline-flex items-center gap-2 rounded-md border border-white/30 px-2.5 py-1.5 text-sm transition hover:bg-white/10"
      >
        <SearchIcon />
        <span className="hidden xl:inline">{t("shell.find")}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("shell.find")}
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-xl">
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
              <SearchIcon />
              <input
                ref={input}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setOpen(false);
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((at) => Math.min(at + 1, found.length - 1));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((at) => Math.max(at - 1, 0));
                  }
                  if (event.key === "Enter") go(found[active]);
                }}
                placeholder={t("shell.findHint")}
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {query.trim() === "" && recent.length > 0 ? (
                <li className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("shell.recent")}</li>
              ) : null}
              {found.length === 0 ? <li className="px-4 py-3 text-sm text-[var(--muted)]">{t("shell.findNone")}</li> : null}
              {found.map((entry, index) => (
                <li key={entry.href}>
                  {query.trim() === "" && recent.length > 0 && index === recent.length ? (
                    <p className="border-t border-[var(--border)] px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("shell.allPages")}</p>
                  ) : null}
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(entry)}
                    className={`flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left text-sm ${
                      index === active ? "bg-[var(--brand-accent)]/15" : ""
                    }`}
                  >
                    <span>{entry.label}</span>
                    {entry.group ? <span className="text-xs text-[var(--muted)]">{entry.group}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The menu on a phone or tablet: one button, a full-height panel, each heading
 * folded until opened (the one holding this page starts open), with the pages
 * recently opened first and the account links at the foot.
 */
export function MobileMenu({
  groups,
  account,
}: {
  groups: NavGroup[];
  /** The person's name and links, and the sign-out form, rendered by the shell. */
  account: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const entries = useMemo(() => flatten(groups), [groups]);
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [unfolded, setUnfolded] = useState<string | null>(null);
  // Closes itself when the page changes: it belongs to the page it was opened on.
  const open = openedOn === pathname;

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenedOn(null);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const here = groups.find((group) => group.label && group.items.some((item) => isCurrent(item.href, pathname)))?.label ?? null;
  const shown = unfolded ?? here;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRecent(readRecent(entries));
          setUnfolded(null);
          setOpenedOn(pathname);
        }}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border border-white/30 px-3 py-1.5 text-sm transition hover:bg-white/10"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
        {t("shell.menu")}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] bg-black/40" onPointerDown={(event) => event.target === event.currentTarget && setOpenedOn(null)}>
          <nav
            aria-label={t("shell.menu")}
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-[var(--surface)] text-[var(--foreground)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <span className="font-semibold">{t("shell.menu")}</span>
              <button type="button" onClick={() => setOpenedOn(null)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm">
                {t("shell.closeMenu")}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {recent.length > 0 ? (
                <div className="mb-2 border-b border-[var(--border)] pb-2">
                  <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("shell.recent")}</p>
                  {recent.map((entry) => (
                    <Link key={entry.href} href={entry.href} className="block rounded-md px-3 py-2 text-sm hover:bg-[var(--border)]/40">
                      {entry.label}
                    </Link>
                  ))}
                </div>
              ) : null}

              {groups.map((group) => {
                if (group.label === null) {
                  const item = group.items[0];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
                      className={`block rounded-md px-3 py-2.5 text-sm font-medium hover:bg-[var(--border)]/40 ${
                        isCurrent(item.href, pathname) ? "bg-[var(--brand-accent)]/15" : ""
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                }
                const isOpen = shown === group.label;
                return (
                  <div key={group.label}>
                    <button
                      type="button"
                      onClick={() => setUnfolded(isOpen ? "" : group.label)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-medium hover:bg-[var(--border)]/40"
                    >
                      {group.label}
                      <span aria-hidden className={`text-[10px] transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                    </button>
                    {isOpen ? (
                      <div className="mb-1 ml-3 border-l border-[var(--border)] pl-2">
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
                            className={`block rounded-md px-3 py-2 text-sm hover:bg-[var(--border)]/40 ${
                              isCurrent(item.href, pathname) ? "font-semibold" : ""
                            }`}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-[var(--border)] px-4 py-3 text-sm">{account}</div>
          </nav>
        </div>
      ) : null}
    </>
  );
}

/** The person's name as a small menu: their account, and signing out. */
export function AccountMenu({ name, children }: { name: string; children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const box = useRef<HTMLDivElement>(null);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpenedOn(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenedOn(null);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpenedOn(open ? null : pathname)}
        aria-expanded={open}
        aria-haspopup="true"
        title={name}
        aria-label={t("shell.account")}
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-white/40 px-1 text-xs font-semibold transition hover:bg-white/10"
      >
        {initials}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--foreground)] shadow-lg">
          {children}
        </div>
      ) : null}
    </div>
  );
}
