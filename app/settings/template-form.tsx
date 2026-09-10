"use client";

import { useActionState, useState } from "react";
import {
  DOCUMENT_FIELDS,
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KIND_NOTES,
  STATUTORY_BLOCKS,
  type DocumentKind,
} from "@/lib/document-fields";
import {
  revertTemplateAction,
  saveTemplateAction,
  type TemplateState,
} from "./template-actions";

export type TemplateRow = {
  id: string;
  kind: string;
  name: string;
  body: string;
  status: string;
  version: number;
};

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/**
 * Your own version of the documents the platform issues.
 *
 * Two things are deliberately visible on this screen and would be easy to
 * leave out. The **fields** you can place, with a real example of each, because
 * "what does qualification.nqfLevel actually look like" is the first question
 * anybody has. And the **sentences the platform adds anyway**, because a
 * provider who cannot see them writes their own copy of them, and then the
 * finished document says everything twice.
 */
export function TemplateForm({ templates }: { templates: TemplateRow[] }) {
  const [state, save, saving] = useActionState<TemplateState, FormData>(
    saveTemplateAction,
    {},
  );
  const [revertState, revert, reverting] = useActionState<
    TemplateState,
    FormData
  >(revertTemplateAction, {});

  const [kind, setKind] = useState<DocumentKind>("statement_of_results");

  const active = templates.find(
    (row) => row.kind === kind && row.status === "active",
  );
  const latest = templates.find((row) => row.kind === kind);
  const showing = active ?? latest;

  const message = state.error || state.notice ? state : revertState;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Which document</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as DocumentKind)}
            className={inputClass}
          >
            {DOCUMENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {DOCUMENT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[var(--muted)]">
            {DOCUMENT_KIND_NOTES[kind]}
          </span>
        </label>

        <div className="text-sm">
          <span className="block font-medium">In use now</span>
          <span className="mt-1.5 block text-[var(--muted)]">
            {active
              ? `Your own: “${active.name}”, version ${active.version}.`
              : "The platform's own layout. Nothing you do here changes a document already issued."}
          </span>
        </div>
      </div>

      <form action={save} className="space-y-3">
        <input type="hidden" name="kind" value={kind} />

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            What you call this version
          </span>
          <input
            name="name"
            defaultValue={showing?.name ?? ""}
            placeholder="Our Statement of Results, 2026"
            maxLength={120}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">The document</span>
          <textarea
            name="body"
            rows={14}
            defaultValue={showing?.body ?? ""}
            placeholder={
              "STATEMENT OF RESULTS\n\n{{ provider.name }}\n{{ provider.address }}\n\nIssued to {{ learner.fullName }}, identity number {{ learner.nationalId }}\nfor {{ qualification.title }} (SAQA {{ qualification.saqaId }}).\n\n{{ modules }}\n\nIssued on {{ document.issuedOn }}. Reference {{ document.reference }}."
            }
            className={`${inputClass} font-mono text-xs`}
            key={showing?.id ?? kind}
          />
          <span className="block text-xs text-[var(--muted)]">
            Write it as you want it to read. Anything in double braces is
            replaced with the learner&rsquo;s own details when the document is
            produced. Your layout is kept exactly as you type it.
          </span>
        </label>

        {message.error ? (
          <p
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {message.error}
          </p>
        ) : null}
        {message.notice ? (
          <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
            {message.notice}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="intent"
            value="activate"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand-primary)" }}
          >
            {saving ? "Saving…" : "Save and use this"}
          </button>
          <button
            type="submit"
            name="intent"
            value="draft"
            disabled={saving}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-60"
          >
            Save as a draft
          </button>
        </div>
      </form>

      {active ? (
        <form action={revert}>
          <input type="hidden" name="kind" value={kind} />
          <button
            type="submit"
            disabled={reverting}
            className="text-sm text-[var(--muted)] underline underline-offset-2 disabled:opacity-60"
          >
            {reverting
              ? "Going back…"
              : "Go back to the platform's own layout"}
          </button>
        </form>
      ) : null}

      <details className="rounded-md border border-[var(--border)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">
          What you can put in it
        </summary>
        <ul className="mt-3 space-y-1.5">
          {DOCUMENT_FIELDS[kind].map((field) => (
            <li key={field.key} className="text-sm">
              <code className="rounded bg-[var(--background)] px-1 py-0.5 font-mono text-xs">
                {`{{ ${field.key} }}`}
              </code>{" "}
              {field.label}
              <span className="block text-xs text-[var(--muted)]">
                {field.repeating ? "A table. " : ""}
                For example: {field.example}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-md border border-[var(--border)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">
          What the platform adds, whatever your template says
        </summary>
        <p className="mt-2 text-sm text-[var(--muted)]">
          These are printed after your template. They are not yours to change
          because they are not yours: a regulator requires them, and a learner
          holding the document relies on them being true. You do not need to
          write them into your own version.
        </p>
        <ul className="mt-3 space-y-2">
          {STATUTORY_BLOCKS[kind].map((block) => (
            <li
              key={block.slice(0, 40)}
              className="border-l-2 border-[var(--brand-accent)] pl-3 text-sm"
            >
              {block}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
