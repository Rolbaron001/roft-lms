"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  acceptLogbookAction,
  signOffAction,
  submitLogbookAction,
  tickEntryAction,
  uploadEvidenceAction,
  type WorkplaceState,
} from "../actions";

const KIND_LABELS: Record<string, string> = {
  work_activity: "Work activities — what you do",
  contextual_knowledge: "Workplace knowledge — what you must be able to speak to",
  supporting_evidence: "Supporting evidence — what the workplace must produce",
};

export type Entry = {
  entryId: string;
  kind: string;
  code: string;
  description: string;
  topicCode: string;
  topicTitle: string;
  completed: boolean;
  evidence: { id: string; filename: string }[];
};

function Pending({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs transition hover:bg-[var(--border)]/30 disabled:opacity-60"
    >
      {pending ? busy : label}
    </button>
  );
}

export function LogbookPanel({
  logbookId,
  entries,
  canEdit,
  canSign,
  canAccept,
  outstanding,
}: {
  logbookId: string;
  entries: Entry[];
  canEdit: boolean;
  canSign: boolean;
  canAccept: boolean;
  outstanding: string[];
}) {
  const [tickState, tickAction] = useActionState<WorkplaceState, FormData>(
    tickEntryAction,
    {},
  );
  const [uploadState, uploadAction] = useActionState<WorkplaceState, FormData>(
    uploadEvidenceAction,
    {},
  );
  const [submitState, submitAction] = useActionState<WorkplaceState, FormData>(
    submitLogbookAction,
    {},
  );
  const [signState, signAction] = useActionState<WorkplaceState, FormData>(
    signOffAction,
    {},
  );
  const [acceptState, acceptAction] = useActionState<WorkplaceState, FormData>(
    acceptLogbookAction,
    {},
  );

  const problem =
    tickState.error ??
    uploadState.error ??
    submitState.error ??
    signState.error ??
    acceptState.error;
  const note =
    uploadState.message ??
    submitState.message ??
    signState.message ??
    acceptState.message;

  const byKind = new Map<string, Entry[]>();
  for (const entry of entries) {
    byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry]);
  }

  return (
    <div className="space-y-6">
      {problem ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {problem}
        </p>
      ) : null}
      {note ? (
        <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm" style={{ color: "var(--success)" }}>
          {note}
        </p>
      ) : null}

      {[...byKind.entries()].map(([kind, items]) => (
        <section key={kind}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            {KIND_LABELS[kind] ?? kind}
          </h3>
          <ul className="space-y-2">
            {items.map((entry) => (
              <li
                key={entry.entryId}
                className="rounded-md border border-[var(--border)] px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm">
                      <span className="font-mono text-xs text-[var(--muted)]">
                        {entry.code}
                      </span>{" "}
                      {entry.description}
                    </p>
                    {entry.evidence.length > 0 ? (
                      <ul className="mt-1 text-xs text-[var(--muted)]">
                        {entry.evidence.map((file) => (
                          <li key={file.id}>📎 {file.filename}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm"
                      style={{
                        color: entry.completed
                          ? "var(--success)"
                          : "var(--muted)",
                      }}
                    >
                      {entry.completed ? "✓ Done" : "○ Not yet"}
                    </span>

                    {canEdit ? (
                      <form action={tickAction}>
                        <input type="hidden" name="entryId" value={entry.entryId} />
                        <input type="hidden" name="logbookId" value={logbookId} />
                        <input
                          type="hidden"
                          name="completed"
                          value={entry.completed ? "no" : "yes"}
                        />
                        <Pending
                          label={entry.completed ? "Undo" : "Mark done"}
                          busy="Saving…"
                        />
                      </form>
                    ) : null}
                  </div>
                </div>

                {canEdit && entry.kind === "supporting_evidence" ? (
                  <form
                    action={uploadAction}
                    className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3"
                  >
                    <input type="hidden" name="entryId" value={entry.entryId} />
                    <input type="hidden" name="logbookId" value={logbookId} />
                    <input
                      type="file"
                      name="file"
                      required
                      className="text-xs"
                    />
                    <Pending label="Attach" busy="Attaching…" />
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {canEdit ? (
        <div className="rounded-lg border border-[var(--border)] p-4">
          {outstanding.length > 0 ? (
            <p className="mb-3 text-sm text-[var(--muted)]">
              Still outstanding: {outstanding.join(", ")}. Your coach cannot
              sign until every line is done and every piece of supporting
              evidence has a file attached.
            </p>
          ) : (
            <p className="mb-3 text-sm" style={{ color: "var(--success)" }}>
              Everything is recorded. Send it to your coach when you are ready.
            </p>
          )}

          <form action={submitAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="logbookId" value={logbookId} />
            <div>
              <label htmlFor="hours" className="block text-xs font-medium">
                Hours in the workplace
              </label>
              <input
                id="hours"
                name="hours"
                type="number"
                min={0}
                className="mt-1 w-32 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              />
            </div>
            <Pending label="Send to my coach" busy="Sending…" />
          </form>
        </div>
      ) : null}

      {canSign ? (
        <div
          className="rounded-lg border-2 p-4"
          style={{ borderColor: "var(--brand-accent)" }}
        >
          <p className="text-sm font-semibold">Your signature</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Signing records that you checked this evidence and will attest to it
            if the assessor contacts you. It cannot be changed afterwards.
          </p>

          <form action={signAction} className="mt-3 space-y-3">
            <input type="hidden" name="logbookId" value={logbookId} />
            <textarea
              name="comments"
              rows={3}
              placeholder="Anything the assessor should know"
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                name="outcome"
                value="signed"
                className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Sign this logbook
              </button>
              <button
                type="submit"
                name="outcome"
                value="returned"
                className="rounded-md border border-[var(--border)] px-4 py-2 text-sm transition hover:bg-[var(--border)]/30"
              >
                Send back to the learner
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {canAccept ? (
        <form action={acceptAction} className="rounded-lg border border-[var(--border)] p-4">
          <input type="hidden" name="logbookId" value={logbookId} />
          <p className="mb-3 text-sm text-[var(--muted)]">
            Signed by the workplace coach and ready to be taken into the
            Portfolio of Evidence.
          </p>
          <Pending label="Receive this logbook" busy="Receiving…" />
        </form>
      ) : null}
    </div>
  );
}
