"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  confirmMatrixAdditionsAction,
  uploadDocumentAction,
  type AdditionsState,
  type UploadState,
} from "./actions";

const FIELD =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload document"}
    </button>
  );
}

export function DocumentUploader({
  qualificationId,
  kinds,
  units,
  modules,
}: {
  qualificationId: string;
  kinds: { value: string; label: string }[];
  units: { id: string; code: string; title: string }[];
  modules: { id: string; code: string; title: string }[];
}) {
  const [state, formAction] = useActionState<UploadState, FormData>(
    uploadDocumentAction,
    {},
  );

  return (
    <div className="space-y-6">
    {state.additions ? <MatrixAdditions additions={state.additions} /> : null}
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="qualificationId" value={qualificationId} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {state.message ? (
        <div className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm">
          <p style={{ color: "var(--success)" }}>{state.message}</p>
          {state.detail ? (
            <ul className="mt-2 space-y-1 text-[var(--muted)]">
              {state.detail.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {/*
            The way out of the form.

            Roland, 21 September: "there is no clear navigation after the
            upload message. The display still looks like I should be doing
            something else on the page." It did, because the form is still
            there under the result and the pointer above it still says to
            upload. The first link is the one to take, so it is the solid
            button; where nothing matched it goes to the problem rather than
            to the top of the page.
          */}
          {state.links && state.links.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--success)]/20 pt-3">
              {state.links.map((link, index) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={
                    index === 0
                      ? "rounded-md px-3 py-1.5 text-sm font-medium text-white"
                      : "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
                  }
                  style={
                    index === 0
                      ? { background: "var(--brand-primary)" }
                      : undefined
                  }
                >
                  {link.label} &rarr;
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="kind" className="block text-sm font-medium">
            What kind of document
          </label>
          <select id="kind" name="kind" required className={FIELD}>
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted)]">
            A curriculum alignment matrix is read as well as stored — what it
            says about each curriculum line is recorded.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="attachTo" className="block text-sm font-medium">
            Attach it to
          </label>
          <select id="attachTo" name="attachTo" className={FIELD}>
            <option value="qualification">The whole qualification</option>
            {units.map((unit) => (
              <option key={unit.id} value={`unit:${unit.id}`}>
                {unit.code} — {unit.title}
              </option>
            ))}
            {modules.map((entry) => (
              <option key={entry.id} value={`module:${entry.id}`}>
                {entry.code} — {entry.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder="Left blank, the file name is used"
            className={FIELD}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="version" className="block text-sm font-medium">
            Version
          </label>
          <input
            id="version"
            name="version"
            type="text"
            placeholder="V2, Final, 07072025"
            className={FIELD}
          />
          <p className="text-xs text-[var(--muted)]">
            Uploading again with the same kind and title supersedes the
            previous one rather than replacing it — the old version stays.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="file" className="block text-sm font-medium">
          File
        </label>
        <input
          id="file"
          name="file"
          type="file"
          required
          accept=".docx,.xlsx,.pdf,.pptx,.doc,.xls,.ppt"
          className={FIELD}
        />
        <p className="text-xs text-[var(--muted)]">
          Word, Excel, PowerPoint and PDF. What the file actually is comes from
          its contents, not its name.
        </p>
      </div>

      <SubmitButton />
    </form>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  topic: "Topic",
  element: "Topic element",
  criterion: "Criterion",
};

/**
 * The lines an alignment matrix names that the curriculum does not have.
 *
 * Roland, 27 September: hold what the provider wants loaded, after they
 * confirm it during the upload. Every line is listed with the reason the
 * matrix gives, all ticked to begin with because the provider wrote the
 * matrix, and nothing is added until the button is pressed.
 */
function MatrixAdditions({
  additions,
}: {
  additions: NonNullable<UploadState["additions"]>;
}) {
  const [state, act, pending] = useActionState<AdditionsState, FormData>(
    confirmMatrixAdditionsAction,
    {},
  );

  if (state.message) {
    return (
      <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm" style={{ color: "var(--success)" }}>
        {state.message}
      </p>
    );
  }

  return (
    <form action={act} className="rounded-md border border-[var(--border)] p-4">
      <input type="hidden" name="qualificationId" value={additions.qualificationId} />
      <input type="hidden" name="documentId" value={additions.documentId} />
      <p className="text-sm font-medium">
        In the matrix, not in the curriculum as held
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Each is added marked as your own, with the reason shown, so a verifier
        can always tell your lines from the regulator&rsquo;s. Untick anything
        that should not be added.
      </p>
      <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto text-sm">
        {additions.items.map((item) => (
          <li key={item.key}>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="add" value={item.key} defaultChecked className="mt-1" />
              <span>
                <span className="font-medium">
                  {KIND_LABEL[item.kind]} {item.moduleCode}
                  {item.topicCode && item.kind !== "topic" ? ` ${item.topicCode}` : ""} {item.code}
                </span>{" "}
                {item.description}
                <span className="block text-xs text-[var(--muted)]">{item.reason}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add the ticked lines to the curriculum"}
      </button>
    </form>
  );
}
