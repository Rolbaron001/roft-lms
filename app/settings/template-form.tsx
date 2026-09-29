"use client";

import { useActionState, useState } from "react";
import {
  DOCUMENT_FIELDS,
  DOCUMENT_KINDS,
  STARTER_TEMPLATES,
  STATUTORY_BLOCKS,
  type DocumentKind,
} from "@/lib/document-fields";
import {
  revertTemplateAction,
  saveTemplateAction,
  type TemplateState,
} from "./template-actions";
import { useT } from "@/components/i18n";

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
  const t = useT();
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
          <span className="block text-sm font-medium">{t("tmpl.which")}</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as DocumentKind)}
            className={inputClass}
          >
            {DOCUMENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`tmpl.kind.${value}`)}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[var(--muted)]">{t(`tmpl.note.${kind}`)}</span>
        </label>

        <div className="text-sm">
          <span className="block font-medium">{t("tmpl.inUse")}</span>
          <span className="mt-1.5 block text-[var(--muted)]">
            {active ? t("tmpl.yours", { name: active.name, version: active.version }) : t("tmpl.platform")}
          </span>
        </div>
      </div>

      <form action={save} className="space-y-3">
        <input type="hidden" name="kind" value={kind} />

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("tmpl.name")}</span>
          <input
            name="name"
            defaultValue={showing?.name ?? ""}
            placeholder={t("tmpl.nameHint")}
            maxLength={120}
            className={inputClass}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("tmpl.document")}</span>
          {/*
            A provider with no template of their own starts from the platform's
            own wording rather than an empty box. An empty textarea beside a
            list of forty field names is a worse invitation than it looks: the
            first thing anybody does is guess at a layout, and the second is
            discover they left out the reference.
          */}
          <textarea
            name="body"
            rows={16}
            defaultValue={showing?.body ?? STARTER_TEMPLATES[kind]}
            className={`${inputClass} font-mono text-xs`}
            key={showing?.id ?? kind}
          />
          <span className="block text-xs text-[var(--muted)]">
            {t("tmpl.documentNote")}
            {showing ? null : ` ${t("tmpl.starterNote")}`}
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
            {saving ? t("common.saving") : t("tmpl.saveUse")}
          </button>
          <button
            type="submit"
            name="intent"
            value="draft"
            disabled={saving}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-60"
          >
            {t("tmpl.saveDraft")}
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
            {reverting ? t("tmpl.goingBack") : t("tmpl.goBack")}
          </button>
        </form>
      ) : null}

      <details className="rounded-md border border-[var(--border)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("tmpl.fields")}
        </summary>
        <ul className="mt-3 space-y-1.5">
          {DOCUMENT_FIELDS[kind].map((field) => (
            <li key={field.key} className="text-sm">
              <code className="rounded bg-[var(--background)] px-1 py-0.5 font-mono text-xs">
                {`{{ ${field.key} }}`}
              </code>{" "}
              {field.label}
              <span className="block text-xs text-[var(--muted)]">
                {field.repeating ? `${t("tmpl.table")} ` : ""}
                {t("tmpl.example", { example: field.example })}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-md border border-[var(--border)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("tmpl.added")}
        </summary>
        <p className="mt-2 text-sm text-[var(--muted)]">{t("tmpl.addedNote")}</p>
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
