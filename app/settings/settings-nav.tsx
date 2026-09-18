"use client";

import { useEffect, useState } from "react";

/**
 * What is on this page, and how to get to it.
 *
 * Roland, 18 September: "It is very difficult to navigate there especially if
 * you don't know all the options that can be found there."
 *
 * The difficulty is not the length of the page, it is that the page never says
 * what is on it. Eight sections stacked vertically, each only discoverable by
 * scrolling past the ones above — so somebody looking for the mail test has to
 * already know it is below terminology, and somebody who does not know the
 * platform can set a clock never finds out.
 *
 * So the list comes first, naming everything, and jumping is a convenience on
 * top of that. A person who reads the list and scrolls has still been told
 * what exists, which is the part that was missing.
 *
 * Built from what the page actually rendered rather than from a second list
 * kept alongside it. Two lists drift, and the way they drift is a section
 * added below and never named above — which is this same complaint again, one
 * release later.
 */
export function SettingsNav() {
  const [sections, setSections] = useState<{ id: string; label: string }[]>([]);
  const [here, setHere] = useState<string | null>(null);

  useEffect(() => {
    /*
     * Which one is in view, so the list says where you are as well as what
     * there is. Cheap enough to do on scroll: eight elements and a rectangle
     * each, and it stops entirely when the page is closed.
     */
    function mark() {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-settings-section]"),
      );

      // Read on the same pass rather than in a second effect: the sections are
      // already in hand, and setting state twice on mount makes React render
      // twice for nothing.
      setSections(
        nodes.map((node) => ({
          id: node.id,
          label: node.dataset.settingsSection ?? node.id,
        })),
      );

      const current = nodes
        .filter((node) => node.getBoundingClientRect().top <= 120)
        .pop();
      setHere(current?.id ?? nodes[0]?.id ?? null);
    }

    /*
     * A timer rather than requestAnimationFrame.
     *
     * rAF does not fire in a tab the browser is not painting, so the list
     * never appeared at all when the window was behind another one - it waited
     * for a frame that was never drawn. A timer fires either way, throttled at
     * worst, and the list is not animation.
     */
    const first = setTimeout(mark, 0);
    window.addEventListener("scroll", mark, { passive: true });

    return () => {
      clearTimeout(first);
      window.removeEventListener("scroll", mark);
    };
  }, []);

  // One section is not a menu. Nothing is gained by listing it.
  if (sections.length < 2) return null;

  return (
    <nav
      aria-label="Settings sections"
      className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        On this page
      </p>
      <ul className="flex flex-wrap gap-x-1 gap-y-1.5 text-sm">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={here === section.id ? "true" : undefined}
              className={`inline-block rounded-md px-2.5 py-1 ${
                here === section.id
                  ? "bg-[var(--brand-primary)] font-medium text-white"
                  : "text-[var(--foreground)] hover:bg-[var(--border)]/40"
              }`}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
