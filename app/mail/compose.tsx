"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { sendMailAction, type MailState } from "./actions";

const FIELD =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function Send({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Sending…" : label}
    </button>
  );
}

export function Compose({
  replyTo,
  replySubject,
  inReplyToMessageId,
  canSend,
}: {
  replyTo?: string;
  replySubject?: string;
  inReplyToMessageId?: string;
  canSend: boolean;
}) {
  const [state, formAction] = useActionState<MailState, FormData>(
    sendMailAction,
    {},
  );
  const [open, setOpen] = useState(Boolean(replyTo));

  if (!canSend) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Sending is not switched on yet — no mail relay is configured, so a
        message written here could not leave the building. Replies you receive
        still arrive normally.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        {replyTo ? "Reply" : "Write a message"}
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p
          className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm"
          style={{ color: "var(--success)" }}
        >
          {state.message}
        </p>
      ) : null}

      {inReplyToMessageId ? (
        <input
          type="hidden"
          name="inReplyToMessageId"
          value={inReplyToMessageId}
        />
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="to" className="block text-sm font-medium">
          To
        </label>
        <input
          id="to"
          name="to"
          type="email"
          required
          defaultValue={replyTo ?? ""}
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="subject" className="block text-sm font-medium">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          defaultValue={
            replySubject
              ? replySubject.toLowerCase().startsWith("re:")
                ? replySubject
                : `Re: ${replySubject}`
              : ""
          }
          className={FIELD}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="body" className="block text-sm font-medium">
          Message
        </label>
        <textarea id="body" name="body" rows={8} required className={FIELD} />
      </div>

      <div className="flex items-center gap-3">
        <Send label="Send" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
