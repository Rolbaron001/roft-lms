"use client";

import { useActionState, useEffect, useRef } from "react";
import { replyAction, startThreadAction, type PostState } from "./actions";
import { useT } from "@/components/i18n";

const FIELD =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/** Starting a discussion on a course's board. */
export function StartThreadForm({ courseId }: { courseId: string }) {
  const t = useT();
  const [state, act, pending] = useActionState<PostState, FormData>(startThreadAction, {});
  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="courseId" value={courseId} />
      {state.error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("discuss.title")}</span>
        <input name="title" required maxLength={200} className={FIELD} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("discuss.body")}</span>
        <textarea name="body" required rows={5} className={FIELD} placeholder={t("discuss.bodyHint")} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? t("discuss.posting") : t("discuss.start")}
      </button>
    </form>
  );
}

/** Replying in a discussion. Clears itself once the reply is posted. */
export function ReplyForm({ threadId }: { threadId: string }) {
  const t = useT();
  const [state, act, pending] = useActionState<PostState, FormData>(replyAction, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.posted) form.current?.reset();
  }, [state.posted]);
  return (
    <form ref={form} action={act} className="space-y-3">
      <input type="hidden" name="threadId" value={threadId} />
      {state.error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("discuss.reply")}</span>
        <textarea name="body" required rows={4} className={FIELD} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {pending ? t("discuss.posting") : t("discuss.post")}
      </button>
    </form>
  );
}
