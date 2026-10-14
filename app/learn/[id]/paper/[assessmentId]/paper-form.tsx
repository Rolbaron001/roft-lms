"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LearnerItem, Sitting } from "@/lib/papers";
import { wordCount } from "@/lib/auto-mark";
import { useT } from "@/components/i18n";

/**
 * Answering a paper on screen.
 *
 * Two things carry the weight here. Answers save themselves, per question, a
 * moment after typing stops — a dropped connection or a closed laptop costs
 * one answer rather than an afternoon, which is the least this has to do to be
 * better than the Word file it replaces. And the declaration is a control
 * rather than a formality: the hand-in button stays disabled until it is
 * ticked, and the server refuses without it regardless.
 *
 * Once handed in, the same page shows the work read-only, and once returned,
 * the mark and comment under each answer (Curiosa's evaluation checklist,
 * 14 October 2026).
 */
export function PaperForm({
  sitting,
  enrolmentId,
}: {
  sitting: Sitting;
  enrolmentId: string;
}) {
  const t = useT();
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | "failed">>(
    {},
  );
  const [declared, setDeclared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const items = sitting.sections.flatMap((section) => section.items);
  const [answered, setAnswered] = useState<Set<string>>(
    () => new Set(items.filter(hasAnswer).map((item) => item.id)),
  );

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

  function markAnswered(itemId: string, yes: boolean) {
    setAnswered((current) => {
      const next = new Set(current);
      if (yes) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

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
        setError(result.error ?? t("paper.notSaved"));
        return;
      }
      setSaving((current) => ({ ...current, [itemId]: "saved" }));
      setError(null);
    } catch {
      setSaving((current) => ({ ...current, [itemId]: "failed" }));
      setError(t("paper.connection"));
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
        setError(result.error ?? result.reasons?.[0] ?? t("paper.handInFailed"));
        return;
      }
      // Back to this paper's place in the list, not the top of the page.
      router.push(`/learn/${enrolmentId}#a-${window.location.pathname.split("/").pop()}`);
    } catch {
      setError(t("paper.handInConnection"));
    } finally {
      setSubmitting(false);
    }
  }

  const readOnly = sitting.status !== "draft";
  const unanswered = items.length - answered.size;
  const returned = sitting.returned;

  return (
    <div className="space-y-6">
      {remaining !== null ? <Clock remaining={remaining} /> : null}

      {!readOnly && items.length > 0 ? (
        <Progress answered={answered.size} total={items.length} />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}

      {readOnly && returned ? (
        <Returned sitting={sitting} />
      ) : readOnly ? (
        <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
          {t("paper.beingMarked")}
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
                {t("paper.marks", { marks: section.markTotal })}
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
                    {item.points === 1 ? t("paper.oneMark") : t("paper.manyMarks", { marks: item.points })}
                    {!readOnly && answered.has(item.id) && !saving[item.id] ? (
                      <span className="ml-2 text-[var(--success)]">✓ {t("paper.answered")}</span>
                    ) : null}
                    <SaveState state={saving[item.id]} />
                  </span>
                </div>

                <div className="mt-2 pl-6">
                  <Answer
                    item={item}
                    readOnly={readOnly}
                    submissionId={sitting.submissionId}
                    save={save}
                    saveSoon={saveSoon}
                    onAnswered={(yes) => markAnswered(item.id, yes)}
                    onError={setError}
                  />
                  {item.result ? <Result item={item} /> : null}
                </div>
              </li>
            ))}
          </ol>

          {returned
            ? returned.sections
                .filter((one) => one.title === section.title)
                .map((one) => (
                  <div
                    key={one.title}
                    className="mt-5 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-4 py-3"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {t("paper.sectionFeedback")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{one.comments}</p>
                  </div>
                ))
            : null}
        </section>
      ))}

      {readOnly ? null : (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-base font-semibold">{t("paper.declaration")}</h2>
          {unanswered > 0 ? (
            <p className="mt-2 text-sm text-[var(--danger)]">
              {unanswered === 1
                ? t("paper.unansweredOne")
                : t("paper.unansweredMany", { count: unanswered })}
            </p>
          ) : null}
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
              {submitting ? t("paper.handingIn") : t("paper.handIn")}
            </button>
            <span className="text-xs text-[var(--muted)]">
              {declared
                ? t("paper.final")
                : t("paper.confirm")}
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

function hasAnswer(item: LearnerItem): boolean {
  const answer = item.answer;
  return Boolean(
    (answer.selectedOptionIds && answer.selectedOptionIds.length > 0) ||
      (answer.answerText && answer.answerText.trim() !== "") ||
      answer.answerNumber !== null ||
      (answer.matchedPairs && Object.keys(answer.matchedPairs).length > 0) ||
      item.files.length > 0,
  );
}

/** The control for one question, by the kind of answer it asks for. */
function Answer({
  item,
  readOnly,
  submissionId,
  save,
  saveSoon,
  onAnswered,
  onError,
}: {
  item: LearnerItem;
  readOnly: boolean;
  submissionId: string;
  save: (itemId: string, body: Record<string, unknown>) => void;
  saveSoon: (itemId: string, body: Record<string, unknown>) => void;
  onAnswered: (yes: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<string[]>(item.answer.selectedOptionIds ?? []);
  const [text, setText] = useState(item.answer.answerText ?? "");
  const [pairs, setPairs] = useState<Record<string, string>>(item.answer.matchedPairs ?? {});

  if (item.type === "matching" && item.matchPrompts && item.options) {
    return (
      <div className="space-y-2">
        {item.matchPrompts.map((prompt) => (
          <label key={prompt.id} className="grid gap-1 text-sm sm:grid-cols-[1fr_16rem] sm:items-center sm:gap-3">
            <span>{prompt.text}</span>
            <select
              disabled={readOnly}
              value={pairs[prompt.id] ?? ""}
              onChange={(event) => {
                const next = { ...pairs, [prompt.id]: event.target.value };
                setPairs(next);
                onAnswered(Object.values(next).some(Boolean));
                save(item.id, { matchedPairs: next });
              }}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="">{t("paper.matchChoose")}</option>
              {item.options!.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }

  if (item.type === "multiple_response" && item.options) {
    return (
      <fieldset className="space-y-1.5" disabled={readOnly}>
        <legend className="mb-1 text-xs text-[var(--muted)]">{t("paper.chooseAll")}</legend>
        {item.options.map((option) => (
          <label key={option.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={chosen.includes(option.id)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...chosen, option.id]
                  : chosen.filter((one) => one !== option.id);
                setChosen(next);
                onAnswered(next.length > 0);
                save(item.id, { selectedOptionIds: next });
              }}
              className="mt-1"
            />
            <span>{option.text}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (item.options && item.options.length > 0) {
    const justified = item.type === "true_false_justified";
    return (
      <div className="space-y-3">
        <fieldset className="space-y-1.5" disabled={readOnly}>
          <legend className="sr-only">{item.stem}</legend>
          {item.options.map((option) => (
            <label key={option.id} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={item.id}
                checked={chosen.includes(option.id)}
                onChange={() => {
                  setChosen([option.id]);
                  onAnswered(true);
                  save(item.id, justified ? { selectedOptionIds: [option.id], answerText: text } : { selectedOptionIds: [option.id] });
                }}
                className="mt-1"
              />
              <span>{option.text}</span>
            </label>
          ))}
        </fieldset>
        {justified ? (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("paper.justify")}</span>
            <TextAnswer
              value={text}
              rows={3}
              readOnly={readOnly}
              placeholder={t("paper.justifyHint")}
              onChange={(value) => {
                setText(value);
                onAnswered(chosen.length > 0 || value.trim() !== "");
                saveSoon(item.id, { selectedOptionIds: chosen, answerText: value });
              }}
            />
          </label>
        ) : null}
      </div>
    );
  }

  if (item.type === "numeric") {
    return (
      <input
        type="number"
        disabled={readOnly}
        defaultValue={item.answer.answerNumber ?? ""}
        onChange={(event) => {
          onAnswered(event.target.value !== "");
          saveSoon(item.id, {
            answerNumber: Number(event.target.value),
          });
        }}
        className="w-40 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
      />
    );
  }

  if (item.type === "file_upload") {
    return (
      <FileAnswer
        item={item}
        readOnly={readOnly}
        submissionId={submissionId}
        onAnswered={onAnswered}
        onError={onError}
      />
    );
  }

  return (
    <TextAnswer
      value={text}
      rows={item.type === "long_answer" ? 10 : 3}
      readOnly={readOnly}
      placeholder={item.type === "long_answer" ? t("paper.detail") : t("assess.yourAnswer")}
      onChange={(value) => {
        setText(value);
        onAnswered(value.trim() !== "");
        saveSoon(item.id, { answerText: value });
      }}
    />
  );
}

/** A written answer with its word count beneath it. */
function TextAnswer({
  value,
  rows,
  readOnly,
  placeholder,
  onChange,
}: {
  value: string;
  rows: number;
  readOnly: boolean;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const words = wordCount(value);
  return (
    <div>
      <textarea
        disabled={readOnly}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm leading-relaxed"
      />
      <p className="mt-0.5 text-right text-xs tabular-nums text-[var(--muted)]">
        {words === 1 ? t("paper.wordsOne") : t("paper.words", { count: words })}
      </p>
    </div>
  );
}

/** A question answered with a file: chosen, uploaded at once, removable until hand-in. */
function FileAnswer({
  item,
  readOnly,
  submissionId,
  onAnswered,
  onError,
}: {
  item: LearnerItem;
  readOnly: boolean;
  submissionId: string;
  onAnswered: (yes: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    onError(null);
    try {
      const form = new FormData();
      form.set("submissionId", submissionId);
      form.set("itemId", item.id);
      form.set("file", file);
      const response = await fetch("/api/paper/file", { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        onError(result.error ?? t("paper.notSaved"));
        return;
      }
      onAnswered(true);
      router.refresh();
    } catch {
      onError(t("paper.connection"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/paper/file?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      onError(result.error ?? t("paper.notSaved"));
      return;
    }
    onAnswered(item.files.length > 1);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {item.files.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {item.files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3">
              <a href={`/api/evidence/${file.id}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {file.filename}
              </a>
              <span className="text-xs text-[var(--muted)]">{describe(file.sizeBytes)}</span>
              {readOnly ? null : (
                <button type="button" onClick={() => remove(file.id)} className="text-xs text-[var(--danger)] underline underline-offset-2">
                  {t("paper.remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : readOnly ? (
        <p className="text-sm italic text-[var(--muted)]">{t("paper.notAnswered")}</p>
      ) : null}

      {readOnly ? null : (
        <>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{busy ? t("paper.attaching") : t("paper.attach")}</span>
            <input
              type="file"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
              className="text-sm"
            />
          </label>
          <p className="text-xs text-[var(--muted)]">{t("paper.accepted")}</p>
        </>
      )}
    </div>
  );
}

/** The mark and comment under an answer, once the work is returned. */
function Result({ item }: { item: LearnerItem }) {
  const t = useT();
  const result = item.result!;
  return (
    <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
      <p className="font-medium tabular-nums">
        {result.awarded === null
          ? t("paper.notMarked")
          : t("paper.yourMark", { awarded: result.awarded, points: item.points })}
        {result.byPlatform ? (
          <span className="ml-2 text-xs font-normal text-[var(--muted)]">{t("paper.byPlatform")}</span>
        ) : null}
      </p>
      {result.comment ? <p className="mt-1 whitespace-pre-wrap">{result.comment}</p> : null}
    </div>
  );
}

/** The overall feedback, marks and any files, at the top of returned work. */
function Returned({ sitting }: { sitting: Sitting }) {
  const t = useT();
  const returned = sitting.returned!;
  const available = returned.marksAvailable || sitting.totalMarks;
  return (
    <section className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-5">
      <h2 className="text-base font-semibold">{t("paper.returnedTitle")}</h2>
      <p className="mt-1 text-sm tabular-nums">
        {t("paper.returnedMarks", { awarded: returned.marksAwarded, available })}
        {returned.outcome === "competent"
          ? ` · ${t("paper.outcome.competent")}`
          : returned.outcome === "not_yet_competent"
            ? ` · ${t("paper.outcome.not_yet_competent")}`
            : ""}
      </p>
      {returned.comments ? (
        <p className="mt-3 whitespace-pre-wrap text-sm">{returned.comments}</p>
      ) : null}
      {returned.attachments.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("paper.feedbackFiles")}
          </p>
          <ul className="mt-2 space-y-3">
            {returned.attachments.map((file) => (
              <li key={file.id} className="text-sm">
                {file.mimeType.startsWith("audio/") ? (
                  <audio controls preload="metadata" src={`/api/feedback-files/${file.id}`} className="w-full max-w-md" />
                ) : file.mimeType.startsWith("video/") ? (
                  <video controls preload="metadata" src={`/api/feedback-files/${file.id}`} className="w-full max-w-xl rounded-md bg-black" />
                ) : null}
                <a href={`/api/feedback-files/${file.id}?download`} className="mt-1 inline-block underline underline-offset-2">
                  {file.filename}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Progress({ answered, total }: { answered: number; total: number }) {
  const t = useT();
  const percent = Math.round((answered / total) * 100);
  return (
    <div className="sticky top-0 z-10 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
      <div className="flex items-center justify-between text-sm">
        <span className="tabular-nums">{t("paper.progress", { answered, total })}</span>
        <span className="text-xs text-[var(--muted)]">{t("paper.savedAsYouGo")}</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--border)]">
        <div className="h-1.5 rounded-full bg-[var(--brand-accent)]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function describe(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function SaveState({ state }: { state?: "saving" | "saved" | "failed" }) {
  const t = useT();
  if (!state) return null;
  const label = t(`paper.state.${state}`);
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
  const t = useT();
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
      {t("paper.remaining", { time: `${minutes}:${String(seconds).padStart(2, "0")}` })}
      {low ? `; ${t("paper.savedAsYouGo")}` : null}
    </div>
  );
}
