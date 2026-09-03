"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * The AI, offered where the work is.
 *
 * Not a page somebody navigates to. This sits inside whatever they are already
 * doing - creating a qualification, uploading material - and offers to do the
 * part that needs reading and judgement.
 *
 * It renders nothing at all for somebody who has not registered an extension.
 * That is the whole reason it is a component rather than a permission check
 * scattered through pages: an affordance that is absent is honest, and one
 * that is present and fails is not.
 *
 * The toggle is the user's. On while it is useful, off while it is not, and
 * off is the default every time the page loads - because a switch left on
 * across sessions is a switch nobody remembers setting.
 */
export function AiAssist({
  title,
  invitation,
  available,
  unavailableReason,
  children,
}: {
  /** What it will do here, in the imperative. */
  title: string;
  /** One line: what it needs from them and what it will give back. */
  invitation: string;
  /** Whether the user has an extension registered and it can run here. */
  available: boolean;
  /** Said plainly when it is registered but cannot run on this machine. */
  unavailableReason?: string | null;
  /** The form that does the work, revealed when they switch it on. */
  children: React.ReactNode;
}) {
  const [on, setOn] = useState(false);

  if (!available && !unavailableReason) return null;

  return (
    <section className="rounded-lg border border-dashed border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{invitation}</p>
        </div>

        {available ? (
          <button
            type="button"
            onClick={() => setOn(!on)}
            aria-pressed={on}
            className={
              on
                ? "rounded-md bg-[var(--brand-primary)] px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            }
          >
            {on ? "Switch off" : "Use the AI"}
          </button>
        ) : null}
      </div>

      {!available && unavailableReason ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          {unavailableReason}{" "}
          <Link href="/account" className="underline">
            Your account
          </Link>
        </p>
      ) : null}

      {on ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}
