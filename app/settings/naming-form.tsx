"use client";

import { useActionState, useState } from "react";
import {
  classifyFilename,
  type NamingConvention,
} from "@/lib/naming-convention";
import { updateNamingAction, type NamingState } from "./actions";

const field =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/** What an artefact code is allowed to mean. The App handles these three. */
const MEANINGS = [
  ["workbook", "Workbook (developmental)"],
  ["summative_assessment", "Summative assessment"],
  ["workplace_signoff", "Workplace sign-off"],
] as const;

type Row = { code: string; meaning: string };

/**
 * How this tenant names its files.
 *
 * The preview is the point of the screen. These settings decide what the App
 * reads out of a filename, and the only way to know whether they are right is
 * to try a real filename against them — so the classifier runs here, in the
 * browser, on every keystroke.
 */
export function NamingForm({ current }: { current: NamingConvention }) {
  const [state, act, pending] = useActionState<NamingState, FormData>(
    updateNamingAction,
    {},
  );

  const [pattern, setPattern] = useState(current.pattern);
  const [marker, setMarker] = useState(current.memorandumMarker);
  const [rows, setRows] = useState<Row[]>(
    Object.entries(current.artefactCodes).map(([code, meaning]) => ({
      code,
      meaning,
    })),
  );
  const [sample, setSample] = useState("CA 121151 SU1 WB1 AG.docx");

  // Built from what is on screen, not from what is saved, so the preview shows
  // the effect of an edit before it is committed.
  const draft: NamingConvention = {
    pattern,
    artefactCodes: Object.fromEntries(
      rows
        .filter((row) => row.code.trim() && row.meaning.trim())
        .map((row) => [row.code.trim().toUpperCase(), row.meaning]),
    ),
    memorandumMarker: marker.trim().toUpperCase() || "AG",
  };

  const read = classifyFilename(sample, draft);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        How filenames are read
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        When somebody uploads a workbook or an assessment, the App reads the
        filename to work out what it is. Get this right and an upload arrives
        already filled in. Get it wrong and nothing breaks — it arrives as a
        blank form for somebody to complete by hand.
      </p>

      <form action={act} className="mt-5 space-y-5">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            The house rule, as your team should follow it
          </span>
          <input
            name="pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            className={`${field} w-full font-mono`}
          />
          <span className="block text-xs text-[var(--muted)]">
            Shown on the upload screen. Guidance for people, not something the
            App matches on — it finds the codes below wherever they appear.
          </span>
        </label>

        <div>
          <span className="block text-sm font-medium">Artefact codes</span>
          <span className="mt-0.5 block text-xs text-[var(--muted)]">
            The part of a filename that says what kind of document it is. These
            are what the App actually matches on.
          </span>

          <div className="mt-2 space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <input
                  name="code"
                  value={row.code}
                  onChange={(event) =>
                    setRows(
                      rows.map((entry, position) =>
                        position === index
                          ? { ...entry, code: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  placeholder="WB"
                  aria-label="Artefact code"
                  className={`${field} w-28 font-mono uppercase`}
                />
                <span className="text-sm text-[var(--muted)]">means</span>
                <select
                  name="meaning"
                  value={row.meaning}
                  onChange={(event) =>
                    setRows(
                      rows.map((entry, position) =>
                        position === index
                          ? { ...entry, meaning: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  aria-label="What this code means"
                  className={`${field} flex-1`}
                >
                  {MEANINGS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setRows(rows.filter((_, position) => position !== index))
                    }
                    className="text-xs text-[var(--danger)] hover:underline"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setRows([...rows, { code: "", meaning: MEANINGS[0][0] }])
            }
            className="mt-2 text-sm font-medium text-[var(--brand-accent)] hover:underline"
          >
            + Another code
          </button>
        </div>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            What marks an answer guide
          </span>
          <input
            name="memorandumMarker"
            value={marker}
            onChange={(event) => setMarker(event.target.value)}
            className={`${field} w-32 font-mono uppercase`}
          />
          <span className="block text-xs text-[var(--muted)]">
            The token that says a file is the memorandum rather than the
            learner&rsquo;s copy.
          </span>
        </label>

        {/* --- the preview --- */}
        <div className="rounded-md border border-[var(--border)] p-4">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Try a filename
            </span>
            <input
              value={sample}
              onChange={(event) => setSample(event.target.value)}
              aria-label="Sample filename"
              className={`${field} w-full font-mono`}
            />
          </label>

          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <Read label="Provider" value={read.provider} />
            <Read label="Qualification" value={read.qualification} />
            <Read label="Study unit" value={read.studyUnit} />
            <Read
              label="Kind of document"
              value={
                read.artefact ? read.artefact.replace(/_/g, " ") : null
              }
            />
            <Read label="Number" value={read.number} />
            <Read
              label="Answer guide"
              value={read.isMemorandum ? "yes" : "no"}
            />
          </dl>

          {read.unread.length > 0 ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              Not read from this name: {read.unread.join(", ")}. Whoever
              uploads it fills those in by hand.
            </p>
          ) : (
            <p className="mt-3 text-xs text-[var(--success)]">
              Everything was read. An upload named like this arrives already
              filled in.
            </p>
          )}
        </div>

        {state.error ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {state.error}
          </p>
        ) : null}
        {state.done ? (
          <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
            {state.done}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}

function Read({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-[var(--muted)]">{label}:</dt>
      <dd className={value ? "font-medium" : "text-[var(--muted)]"}>
        {value ?? "—"}
      </dd>
    </div>
  );
}
