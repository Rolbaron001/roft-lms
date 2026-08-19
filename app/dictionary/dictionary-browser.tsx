"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import type { DefinedBy, DictionaryEntry } from "@/lib/dictionary";

const SOURCE_LABEL: Record<DefinedBy, string> = {
  authority: "Set by an authority",
  platform: "ROFT's own term",
  practice: "Common practice",
};

const SOURCE_TONE: Record<DefinedBy, string> = {
  authority:
    "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]",
  platform:
    "border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 text-[var(--brand-accent)]",
  practice: "border-[var(--muted)]/30 bg-[var(--muted)]/10 text-[var(--muted)]",
};

/**
 * The whole dictionary is a few pages of text, so it is sent to the browser
 * once and filtered there. No round trip per keystroke, and it keeps working
 * when the connection does not.
 */
export function DictionaryBrowser({
  entries,
  categories,
  meanings,
}: {
  entries: DictionaryEntry[];
  categories: Record<string, string>;
  meanings: Record<DefinedBy, string>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [source, setSource] = useState<DefinedBy | "">("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category && entry.category !== category) return false;
      if (source && entry.definedBy !== source) return false;
      if (!needle) return true;
      return (
        entry.term.toLowerCase().includes(needle) ||
        (entry.abbreviation ?? "").toLowerCase().includes(needle) ||
        entry.definition.toLowerCase().includes(needle)
      );
    });
  }, [entries, query, category, source]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-56 text-sm">
            <span className="mb-1 block font-medium">Search</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="A term, an abbreviation, or a word in a definition"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Area</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="">All areas</option>
              {Object.entries(categories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Who defines it</span>
            <select
              value={source}
              onChange={(event) =>
                setSource(event.target.value as DefinedBy | "")
              }
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="">Anyone</option>
              <option value="authority">Set by an authority</option>
              <option value="platform">ROFT&rsquo;s own term</option>
              <option value="practice">Common practice</option>
            </select>
          </label>
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">
          {visible.length} of {entries.length} terms
          {source ? ` — ${meanings[source]}` : ""}
        </p>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            Nothing matches. If a term is missing and it is one we use, it
            belongs here — say so and it will be added in the next release.
          </p>
        </Card>
      ) : null}

      <div className="space-y-3">
        {visible.map((entry) => (
          <article
            key={entry.term}
            id={slug(entry.term)}
            className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">
                {entry.term}
                {entry.abbreviation ? (
                  <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                    ({entry.abbreviation})
                  </span>
                ) : null}
              </h2>
              <span
                title={meanings[entry.definedBy]}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${SOURCE_TONE[entry.definedBy]}`}
              >
                {entry.definedBy === "authority" && entry.authority
                  ? entry.authority
                  : SOURCE_LABEL[entry.definedBy]}
              </span>
            </div>

            <p className="mt-2 text-sm leading-relaxed">{entry.definition}</p>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              <span>{categories[entry.category] ?? entry.category}</span>
              {entry.seeAlso.length > 0 ? (
                <span>
                  See also:{" "}
                  {entry.seeAlso.map((reference, index) => (
                    <span key={reference}>
                      {index > 0 ? ", " : ""}
                      <a
                        href={`#${slug(reference)}`}
                        onClick={() => {
                          // Clear the filters, or the anchor jumps to an
                          // element the current filter has hidden.
                          setQuery("");
                          setCategory("");
                          setSource("");
                        }}
                        className="underline underline-offset-2"
                      >
                        {reference}
                      </a>
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function slug(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
