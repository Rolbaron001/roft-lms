"use client";

import { useEffect, useState } from "react";

/**
 * What is on this page, and where you are in it, kept in view.
 *
 * Roland, 19 September: "A floating navigation bar or sub-menu would work
 * better for such long pages." The qualification page runs to fifteen modules,
 * five hundred curriculum lines and eighty documents; by the time somebody is
 * reading a criterion, every heading and every tab is a screen and a half
 * above them, and the only way back is the scrollbar.
 *
 * This is the same idea as the Settings list - which came from the same
 * complaint a day earlier - with one difference that matters: it sticks. A
 * list at the top answers "what is on this page" once, on arrival. A long page
 * needs it answered again at the point somebody gets lost, which is never at
 * the top.
 *
 * Built from what the page actually rendered, not from a second list kept
 * alongside. Two lists drift, and the way they drift is a section added below
 * and never named above - which is the original complaint again, one release
 * later. Mark a section with `data-page-section="Its name"` and it appears.
 */
export function PageNav({
  label = "On this page",
  attribute = "data-page-section",
  ariaLabel = "On this page",
}: {
  /** The heading above the list. */
  label?: string;
  /** Which attribute marks a section, so Settings can keep its own. */
  attribute?: string;
  ariaLabel?: string;
}) {
  const [sections, setSections] = useState<{ id: string; label: string }[]>([]);
  const [here, setHere] = useState<string | null>(null);

  useEffect(() => {
    function mark() {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(`[${attribute}]`),
      );

      /*
       * Read on the same pass rather than in a second effect: the sections are
       * already in hand, and setting state twice on mount makes React render
       * twice for nothing.
       *
       * Only when it has actually changed, though. This runs on every scroll
       * event, and handing React a fresh array each time re-renders the whole
       * list sixty times a second for a list that has not moved.
       */
      const found = nodes.map((node) => ({
        id: node.id,
        label: node.getAttribute(attribute) ?? node.id,
      }));

      setSections((current) =>
        current.length === found.length &&
        current.every(
          (one, index) =>
            one.id === found[index].id && one.label === found[index].label,
        )
          ? current
          : found,
      );

      // The last one whose top has passed under the header. Filtering rather
      // than finding the first below: "where am I" is the section you are
      // reading, which is the one you have most recently scrolled into.
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
    window.addEventListener("resize", mark, { passive: true });

    return () => {
      clearTimeout(first);
      window.removeEventListener("scroll", mark);
      window.removeEventListener("resize", mark);
    };
  }, [attribute]);

  // One section is not a menu. Nothing is gained by listing it.
  if (sections.length < 2) return null;

  return (
    <nav
      aria-label={ariaLabel}
      /*
       * Sticky rather than fixed. Fixed would float over the page from the
       * first pixel and cover the heading somebody just arrived at; sticky
       * sits where it was written and only takes over once it would otherwise
       * scroll away.
       *
       * The negative margin and the matching padding let the backdrop run to
       * the full width of the column while the list stays aligned with the
       * text beneath it.
       */
      className="sticky top-0 z-30 -mx-4 mb-6 border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg)]/80"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          {label}
        </span>
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
      </div>
    </nav>
  );
}
