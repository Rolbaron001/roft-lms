"use client";

import { useActionState, useState } from "react";
import { saveMenuAction, type MenuState } from "./menu-actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type MenuPage = { href: string; label: string };
export type MenuSection = { label: string | null; items: MenuPage[] };

/**
 * Rearranging the menu.
 *
 * Headings can be renamed, added, emptied and reordered, and any page can be
 * moved between them. What cannot be done is hiding a page: the menu is
 * filtered by permission already, and a provider who could also hide things
 * would have two overlapping ways to make a page unreachable and no single
 * place that explains why somebody cannot find it.
 *
 * Buttons rather than drag-and-drop. Dragging is nicer with a mouse and
 * unusable without one, and this screen is used once or twice in the life of a
 * deployment - so it is built to be obvious rather than pleasant.
 *
 * A page moved to the heading named "" (nothing) becomes a direct link on the
 * bar rather than sitting inside a menu, which is how Home and Mail work.
 */
export function MenuEditor({ current }: { current: MenuSection[] }) {
  const [state, action, saving] = useActionState<MenuState, FormData>(
    saveMenuAction,
    {},
  );
  const [sections, setSections] = useState<MenuSection[]>(current);

  function rename(index: number, label: string) {
    setSections((rows) =>
      rows.map((row, at) => (at === index ? { ...row, label } : row)),
    );
  }

  function moveSection(index: number, by: number) {
    setSections((rows) => {
      const to = index + by;
      if (to < 0 || to >= rows.length) return rows;
      const copy = [...rows];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  }

  function movePage(from: number, href: string, to: number) {
    setSections((rows) => {
      const page = rows[from].items.find((item) => item.href === href);
      if (!page) return rows;
      return rows.map((row, at) => {
        if (at === from) {
          return {
            ...row,
            items: row.items.filter((item) => item.href !== href),
          };
        }
        if (at === to) return { ...row, items: [...row.items, page] };
        return row;
      });
    });
  }

  function movePageWithin(sectionAt: number, href: string, by: number) {
    setSections((rows) =>
      rows.map((row, at) => {
        if (at !== sectionAt) return row;
        const index = row.items.findIndex((item) => item.href === href);
        const to = index + by;
        if (index === -1 || to < 0 || to >= row.items.length) return row;
        const items = [...row.items];
        [items[index], items[to]] = [items[to], items[index]];
        return { ...row, items };
      }),
    );
  }

  function addSection() {
    setSections((rows) => [...rows, { label: "New heading", items: [] }]);
  }

  return (
    <form action={action} className="space-y-4">
      {/* The whole arrangement as one field. A dozen inputs named by index
          would be a form whose meaning depends on nothing having shifted. */}
      <input
        type="hidden"
        name="arrangement"
        value={JSON.stringify(
          sections.map((section) => ({
            label: section.label?.trim() ? section.label.trim() : null,
            items: section.items.map((item) => item.href),
          })),
        )}
      />

      <div className="space-y-3">
        {sections.map((section, index) => (
          <div
            key={index}
            className="rounded-md border border-[var(--border)] p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={section.label ?? ""}
                onChange={(event) => rename(index, event.target.value)}
                placeholder="No heading — shown as direct links"
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => moveSection(index, -1)}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                aria-label="Move this heading left"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => moveSection(index, 1)}
                className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                aria-label="Move this heading right"
              >
                →
              </button>
            </div>

            {section.items.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Empty. A heading with nothing under it is not shown.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => (
                  <li
                    key={item.href}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="min-w-[10rem] flex-1">
                      {item.label}
                      <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                        {item.href}
                      </span>
                    </span>

                    <button
                      type="button"
                      onClick={() => movePageWithin(index, item.href, -1)}
                      className="rounded border border-[var(--border)] px-2 py-0.5 text-xs"
                      aria-label={`Move ${item.label} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePageWithin(index, item.href, 1)}
                      className="rounded border border-[var(--border)] px-2 py-0.5 text-xs"
                      aria-label={`Move ${item.label} down`}
                    >
                      ↓
                    </button>

                    <select
                      value={index}
                      onChange={(event) =>
                        movePage(index, item.href, Number(event.target.value))
                      }
                      aria-label={`Which heading ${item.label} sits under`}
                      className={`${inputClass} py-0.5 text-xs`}
                    >
                      {sections.map((option, at) => (
                        <option key={at} value={at}>
                          {option.label?.trim() || "No heading"}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addSection}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Add a heading
        </button>
        <button
          type="submit"
          name="intent"
          value="reset"
          disabled={saving}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-60"
        >
          Back to the standard menu
        </button>
      </div>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <p className="max-w-2xl text-xs text-[var(--muted)]">
        Pages cannot be hidden here. What each person sees is already decided by
        their role, and a second way to make something unreachable would leave
        nobody able to say why a page is missing. A page added to the platform
        later appears under its usual heading rather than disappearing because
        this arrangement predates it.
      </p>

      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save this arrangement"}
      </button>
    </form>
  );
}
