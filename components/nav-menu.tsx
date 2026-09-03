"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavLink = { href: string; label: string };
export type NavGroup = {
  /** Null for a link that stands on its own rather than opening a menu. */
  label: string | null;
  items: NavLink[];
};

/**
 * The main navigation, grouped.
 *
 * It was a single flat row of every page somebody could reach - twenty-four of
 * them for an administrator, wrapping onto three lines and reading as a wall.
 * A list that long stops being navigation: nothing is findable by scanning it,
 * only by already knowing where the thing is.
 *
 * So related pages sit behind one heading each, which puts seven things on the
 * bar instead of twenty-four. The two that are opened many times a day - Home
 * and Mail - stay as direct links, because burying a daily destination one
 * click deeper to tidy the bar is a bad trade.
 *
 * A group holding one visible item renders as a plain link rather than a menu
 * of one. Which items a person sees depends on their permissions, so a group
 * that is rich for an administrator can come down to a single entry for an
 * assessor, and a dropdown containing one thing is worse than no dropdown.
 */
export function NavMenu({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);

  // Which menu is open, remembered against the page it was opened on.
  //
  // Navigating has to close it, and the obvious way - an effect on pathname
  // that clears the state - is a second render every time anybody moves. Tying
  // the open menu to the page it belongs to closes it as a consequence of the
  // route changing rather than as a reaction to it.
  const [opened, setOpened] = useState<{ path: string; label: string } | null>(
    null,
  );
  const open = opened?.path === pathname ? opened.label : null;

  function setOpen(label: string | null) {
    setOpened(label === null ? null : { path: pathname, label });
  }

  // Close on a click anywhere else and on Escape. Both are expected of a menu,
  // and without them the panel follows you around the page.
  useEffect(() => {
    if (open === null) return;

    // setOpened rather than the setOpen helper, so this effect depends only on
    // whether something is open. The helper closes over pathname, which would
    // make every navigation tear the listeners down and rebuild them.
    function onPointerDown(event: PointerEvent) {
      if (!nav.current?.contains(event.target as Node)) setOpened(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpened(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function holdsCurrentPage(items: NavLink[]): boolean {
    return items.some((item) => isCurrent(item.href, pathname));
  }

  return (
    <nav
      ref={nav}
      className="mx-auto flex max-w-5xl flex-wrap items-center gap-1 px-6 pb-1"
    >
      {groups.map((group) => {
        if (group.items.length === 0) return null;

        // A heading over one item is just that item.
        if (group.label === null || group.items.length === 1) {
          const item = group.items[0];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href, pathname) ? "page" : undefined}
              className={itemClass(isCurrent(item.href, pathname))}
            >
              {item.label}
            </Link>
          );
        }

        const here = holdsCurrentPage(group.items);
        const isOpen = open === group.label;

        return (
          <div key={group.label} className="relative">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : group.label)}
              aria-expanded={isOpen}
              aria-haspopup="true"
              className={`${itemClass(here)} inline-flex items-center gap-1.5`}
            >
              {group.label}
              <span
                aria-hidden
                className={`text-[10px] leading-none transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </button>

            {isOpen ? (
              <div
                // Rendered in the header's dark band, so the panel carries its
                // own light surface rather than inheriting one.
                className="absolute left-0 z-50 mt-1 min-w-[13rem] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
              >
                {group.items.map((item) => {
                  const current = isCurrent(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={current ? "page" : undefined}
                      className={`block px-4 py-2 text-sm text-[var(--foreground)] transition hover:bg-[var(--brand-accent)] ${
                        current ? "font-semibold" : ""
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function itemClass(active: boolean): string {
  return [
    "rounded-t-md px-4 py-2 text-sm transition hover:bg-white/10",
    active ? "bg-white/15 font-medium" : "",
  ].join(" ");
}

/**
 * Whether a link points at the page being looked at.
 *
 * "/" only ever matches itself; every other href matches its own subtree, so
 * that a learner's record under /people/<id> still shows People as the section
 * they are in.
 */
function isCurrent(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
