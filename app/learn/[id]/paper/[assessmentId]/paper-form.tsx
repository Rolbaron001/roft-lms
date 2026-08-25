"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Sitting } from "@/lib/papers";

/**
 * Answering a paper on screen.
 *
 * Two things carry the weight here. Answers save themselves, per question, a
 * moment after typing stops — a dropped connection or a closed laptop costs
 * one answer rather than an afternoon, which is the least this has to do to be
 * better than the Word file it replaces. And the declaration is a control
 * rather than a formality: the hand-in button stays disabled until it is
 * ticked, and the server refuses without it regardless.
 */
export function PaperForm({
  sitting,
  enrolmentId,
}: {
  sitting: Sitting;
  enrolmentId: string;
}) {
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | "failed">>(
    {},
  );
  const [declared, setDeclared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const router = useRouter();

  // The clock the learner sees is a courtesy. The one that counts runs on the
  // server from the moment the attempt opened, so a page left open overnight
  // gains nobody anything.
  useEffect(() => {
    if (!sitting.closesAt) return;
    const closesAt = new Date(sitting.closesAt).getTime();

    const tick = () => {
      const left = Math.max(0, closesAt - Date.now());
      setRemaining(left);
      if (left === 0) window.location.reload();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sitting.closesAt]);

  async function save(itemId: string, body: Record<string, unknown>) {
    setSaving((current) => ({ ...current, [itemId]: "saving" }));
    try {
      const response = await fetch("/api/paper/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: sitting.submissionId,
          itemId,
          ...body,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setSaving((current) => ({ ...current, [itemId]: "failed" }));
        setError(result.error ?? "That answer did not save.");
        return;
      }
      setSaving((current) => ({ ...current, [itemId]: "saved" }));
      setError(null);
    } catch {
      setSaving((current) => ({ ...current, [itemId]: "failed" }));
      setError(
        "That answer did not save. Your connection may have dropped — it will be retried when you next change something.",
      );
    }
  }

  /** Typing settles before a write, so a paragraph is one save and not fifty. */
  function saveSoon(itemId: string, body: Record<string, unknown>) {
    clearTimeout(timers.current[itemId]);
    setSaving((current) => ({ ...current, [itemId]: "saving" }));
    timers.current[itemId] = setTimeout(() => save(itemId, body), 800);
  }

  async function handIn() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/paper/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: sitting.submissionId,
          declarationAccepted: declared,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result.error ?? result.reasons?.[0] ?? "That could not be handed in.");
        return;
      }
      router.push(`/learn/${enrolmentId}`);
    } catch {
      setError("That could not be handed in. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const readOnly = sitting.status !== "draft";

  return (
    <div className="space-y-6">
      {remaining !== null ? <Clock remaining={remaining} /> : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}

      {sitting.sections.map((section) => (
        <section
          key={section.id}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">{section.title}</h2>
            {section.markTotal !== null ? (
              <span className="text-xs text-[var(--muted)]">
                {section.markTotal} marks
              </span>
            ) : null}
          </div>

          {section.instruction ? (
            <p className="mt-1 text-sm text-[var(--muted)]">
              {section.instruction}
            </p>
          ) : null}

          {section.stimulus ? (
            <div className="mt-4 whitespace-pre-wrap rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-4 text-sm leading-relaxed">
              {section.stimulus}
            </div>
          ) : null}

          <ol className="mt-4 space-y-5">
            {section.items.map((item, index) => (
              <li key={item.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    <span className="mr-2 tabular-nums text-[var(--muted)]">
                      {index + 1}.
                    </span>
                    {item.stem}
                  </p>
                  <span className="text-xs text-[var(--muted)]">
                    {item.points} {item.points === 1 ? "mark" : "marks"}
                    <SaveState state={saving[item.id]} />
                  </span>
                </div>

                <div className="mt-2 pl-6">
                  {item.options ? (
                    <fieldset className="space-y-1.5" disabled={readOnly}>
                      <legend className="sr-only">{item.stem}</legend>
                      {item.options.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-start gap-2 text-sm"
                        >
                          <input
                            type="radio"
                            name={item.id}
                            defaultChecked={item.answer.selectedOptionIds?.includes(
                              option.id,
                            )}
                            onChange={() =>
                              save(item.id, { selectedOptionIds: [option.id] })
                            }
                            className="mt-1"
                          />
                          <span>{option.text}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : item.type === "numeric" ? (
                    <input
                      type="number"
                      disabled={readOnly}
                      defaultValue={item.answer.answerNumber ?? ""}
                      onChange={(event) =>
                        saveSoon(item.id, {
                          answerNumber: Number(event.target.value),
                        })
                      }
                      className="w-40 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                    />
                  ) : (
                    <textarea
                      disabled={readOnly}
                      defaultValue={item.answer.answerText ?? ""}
                      rows={item.type === "long_answer" ? 10 : 3}
                      onChange={(event) =>
                        saveSoon(item.id, { answerText: event.target.value })
                      }
                      placeholder={
                        item.type === "long_answer"
                          ? "Answer in detail, referring to the principles you have studied."
                          : "Your answer"
                      }
                      className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm leading-relaxed"
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {readOnly ? (
        <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
          You handed this in. It cannot be changed.
        </p>
      ) : (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-base font-semibold">Declaration</h2>
          <label className="mt-3 flex items-start gap-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              checked={declared}
              onChange={(event) => setDeclared(event.target.checked)}
              className="mt-1"
            />
            <span>{sitting.declarationText}</span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handIn}
              disabled={!declared || submitting}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--brand-primary)" }}
            >
              {submitting ? "Handing in…" : "Hand in"}
            </button>
            <span className="text-xs text-[var(--muted)]">
              {declared
                ? "Once handed in, this cannot be changed."
                : "Confirm the declaration to hand in."}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function SaveState({ state }: { state?: "saving" | "saved" | "failed" }) {
  if (!state) return null;
  const label =
    state === "saving" ? "saving…" : state === "saved" ? "saved" : "not saved";
  return (
    <span
      className={`ml-2 ${state === "failed" ? "text-[var(--danger)]" : ""}`}
      aria-live="polite"
    >
      {label}
    </span>
  );
}

function Clock({ remaining }: { remaining: number }) {
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const low = remaining < 5 * 60_000;

  return (
    <div
      className={`sticky top-0 z-10 rounded-md border px-4 py-2 text-sm font-medium tabular-nums ${
        low
          ? "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]"
          : "border-[var(--border)] bg-[var(--surface)]"
      }`}
      role="timer"
      aria-live={low ? "polite" : "off"}
    >
      {minutes}:{String(seconds).padStart(2, "0")} remaining
      {low ? " — your work is saved as you go" : null}
    </div>
  );
}
