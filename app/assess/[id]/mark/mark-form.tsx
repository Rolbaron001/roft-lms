"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  addFeedbackFileAction,
  commentOnSectionAction,
  markItemAction,
  removeFeedbackFileAction,
  returnFeedbackAction,
  type FileState,
  type MarkState,
  type SectionState,
} from "./actions";
import type { MarkedItem, MarkedPaper, RubricView } from "@/lib/marking";
import { wordCount } from "@/lib/auto-mark";
import { useT } from "@/components/i18n";

/**
 * Marking a paper question by question.
 *
 * The learner's answer, the model answer and the rubric sit together on one
 * screen, because an assessor who has to hold the memorandum in another window
 * marks less consistently than one who does not. Each question saves on its
 * own, and saves itself a moment after a mark or comment is typed: a fifty-mark
 * paper is marked over an hour with interruptions, not in one sitting, and
 * losing half of it to a closed tab would be its own kind of failure.
 *
 * Questions the platform marks arrive marked, with the learner's choice and
 * the key side by side. The assessor confirms by leaving them, or changes the
 * mark and may say why; both figures are kept (Curiosa's evaluation
 * checklist, 14 October 2026).
 */
export function MarkForm({
  paper,
  rubrics,
  criteria,
  links,
}: {
  paper: MarkedPaper;
  rubrics: Record<string, RubricView>;
  criteria: { id: string; code: string; description: string }[];
  /** Where to write to the learner, and the next piece of work waiting. */
  links: { message: string | null; next: string | null };
}) {
  const t = useT();

  /**
   * Questions gathered under the section each belongs to.
   *
   * Driven by the paper's own section order rather than by where the section
   * changes as the items are walked. That distinction is not academic: item
   * sort order restarts at zero in every section, so the flat list interleaves
   * them - A, C, B, D across two sections - and an adjacency-based grouping
   * produced four groups and four comment boxes for two sections.
   *
   * Questions are numbered within their section, as the learner's screen
   * numbers them, so "Activity 3, question 2" means the same to both.
   * Numbering from the flat list read 2, 5, 7, 1 (14 October 2026), because
   * that list interleaves the sections.
   */
  const grouped = [
    ...paper.sections.map((section) => ({
      key: section.id,
      section,
      items: paper.items.filter((item) => item.sectionId === section.id),
    })),
    // A paper with no sections at all, or an item that belongs to none.
    {
      key: "__none__",
      section: null,
      items: paper.items.filter((item) => item.sectionId === null),
    },
  ]
    .filter((group) => group.items.length > 0)
    .map((group) => ({ ...group, items: group.items.map((item, index) => ({ item, index })) }));

  return (
    <div className="space-y-6">
      <Summary paper={paper} links={links} />

      {paper.evidence.length > 0 ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold">{t("marking.evidence")}</h2>
          <Files files={paper.evidence} />
        </section>
      ) : null}

      {/*
        Grouped by section where the paper has sections, so a comment on the
        section sits under the questions it is about. A paper with no sections
        - an older one, or a short quiz - renders exactly as it did.
      */}
      {grouped.map((group) => (
        <div key={group.key} className="space-y-6">
          {group.section ? (
            <h3 className="pt-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              {group.section.title}
            </h3>
          ) : null}

          {group.items.map(({ item, index }) => (
            <Question
              key={item.itemId}
              item={item}
              index={index}
              submissionId={paper.submissionId}
              rubric={item.rubricId ? rubrics[item.rubricId] : undefined}
            />
          ))}

          {group.section ? (
            <SectionComment
              submissionId={paper.submissionId}
              section={group.section}
            />
          ) : null}
        </div>
      ))}

      {paper.purpose === "formative" ? (
        <FeedbackPanel
          paper={paper}
          criteria={criteria}
          next={links.next}
        />
      ) : null}
    </div>
  );
}

/**
 * The paper's totals, the platform's part and the assessor's part apart, so
 * the combined figure can be checked before it goes back to the learner.
 */
function Summary({ paper, links }: { paper: MarkedPaper; links: { message: string | null; next: string | null } }) {
  const t = useT();
  const platform = paper.items.filter((item) => item.autoMarks !== null);
  const person = paper.items.filter((item) => item.autoMarks === null);
  const sum = (rows: MarkedItem[], pick: (item: MarkedItem) => number) => rows.reduce((total, item) => total + pick(item), 0);
  const toMark = paper.items.filter((item) => item.awarded === null).length;
  const changed = platform.filter((item) => item.awarded !== null && item.awarded !== item.autoMarks).length;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{paper.assessmentTitle}</h2>
          <p className="text-sm text-[var(--muted)]">{paper.learnerName}</p>
        </div>
        <span className="text-sm tabular-nums">
          {t("marking.total", { awarded: paper.marksAwarded, available: paper.marksAvailable })}
          <span className="ml-2 text-[var(--muted)]">
            {t("marking.percent", { percent: Math.round(paper.percentage), pass: paper.passMark })}
          </span>
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-md border border-[var(--border)] px-3 py-2">
          <dt className="text-xs text-[var(--muted)]">{t("marking.byPlatform")}</dt>
          <dd className="tabular-nums">
            {t("marking.partMarks", {
              count: platform.length,
              awarded: sum(platform, (item) => item.awarded ?? 0),
              available: sum(platform, (item) => item.points),
            })}
            {changed > 0 ? <span className="block text-xs text-[var(--muted)]">{t("marking.changedCount", { count: changed })}</span> : null}
          </dd>
        </div>
        <div className="rounded-md border border-[var(--border)] px-3 py-2">
          <dt className="text-xs text-[var(--muted)]">{t("marking.byYou")}</dt>
          <dd className="tabular-nums">
            {t("marking.partMarks", {
              count: person.length,
              awarded: sum(person, (item) => item.awarded ?? 0),
              available: sum(person, (item) => item.points),
            })}
          </dd>
        </div>
        <div className="rounded-md border border-[var(--border)] px-3 py-2">
          <dt className="text-xs text-[var(--muted)]">{t("marking.stillToMark")}</dt>
          <dd className={`tabular-nums ${toMark > 0 ? "font-medium" : ""}`}>
            {toMark === 0 ? t("marking.noneLeft") : toMark === 1 ? t("marking.toMarkOne") : t("marking.toMarkMany", { count: toMark })}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-sm text-[var(--muted)]">
        {paper.purpose === "summative" ? t("marking.summative") : t("marking.formative")}
      </p>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {links.message ? (
          <a href={links.message} className="font-medium text-[var(--brand-accent)] underline underline-offset-2">
            {t("marking.message")}
          </a>
        ) : null}
        {links.next ? (
          <a href={links.next} className="font-medium text-[var(--brand-accent)] underline underline-offset-2">
            {t("marking.next")}
          </a>
        ) : null}
      </div>
    </section>
  );
}

/** The mark a rubric gives, the same arithmetic the server uses. */
function rubricMarks(rubric: RubricView, chosen: Record<string, string>, points: number): number | null {
  let weighted = 0;
  let total = 0;
  for (const dimension of rubric.dimensions) {
    const level = rubric.levels.find((one) => one.id === chosen[dimension.id]);
    if (!level) return null;
    weighted += ((level.minPercent + level.maxPercent) / 2) * dimension.weight;
    total += dimension.weight;
  }
  const percentage = total === 0 ? 0 : weighted / total;
  return Math.round((percentage / 100) * points * 2) / 2;
}

function Question({
  item,
  index,
  submissionId,
  rubric,
}: {
  item: MarkedItem;
  index: number;
  submissionId: string;
  rubric?: RubricView;
}) {
  const t = useT();
  const [state, mark, marking] = useActionState<MarkState, FormData>(markItemAction, {});
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [levels, setLevels] = useState<Record<string, string>>(item.chosenLevels ?? {});
  const [marks, setMarks] = useState(item.awarded === null ? "" : String(item.awarded));
  const [dirty, setDirty] = useState(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const fromRubric = rubric ? rubricMarks(rubric, levels, item.points) : null;
  const departs = item.autoMarks !== null && marks !== "" && Number(marks) !== item.autoMarks;

  /** Saves itself once there is a mark to save, a moment after typing stops. */
  function changed() {
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const data = form.current ? new FormData(form.current) : null;
      const hasMark = data && String(data.get("marks") ?? "").trim() !== "";
      const rubricDone = rubric ? rubric.dimensions.every((dimension) => data?.get(`level:${dimension.id}`)) : false;
      if (hasMark || rubricDone) form.current?.requestSubmit();
    }, 1200);
  }

  const status = marking
    ? t("common.saving")
    : state.error
      ? null
      : dirty
        ? t("marking.unsaved")
        : state.marked === item.itemId
          ? t("marking.savedNow")
          : null;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          <span className="mr-2 tabular-nums text-[var(--muted)]">
            {index + 1}.
          </span>
          {item.stem}
        </h3>
        <span className="text-xs text-[var(--muted)]">
          {item.awarded === null
            ? item.points === 1
              ? t("marking.notMarkedOne")
              : t("marking.notMarked", { points: item.points })
            : t("marking.awarded", { awarded: item.awarded, points: item.points })}
          {item.byPlatform ? (
            <span className="ml-2 rounded bg-[var(--brand-accent)]/10 px-1.5 py-0.5 font-medium text-[var(--brand-accent)]">
              {t("marking.platformBadge")}
            </span>
          ) : item.autoMarks !== null && item.awarded !== item.autoMarks ? (
            <span className="ml-2 rounded border border-[var(--border)] px-1.5 py-0.5 font-medium">
              {t("marking.changedFrom", { marks: item.autoMarks })}
            </span>
          ) : null}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("marking.answer")}
          </p>
          <LearnerAnswer item={item} />
        </div>

        <Guidance item={item} />
      </div>

      <form ref={form} action={mark} onSubmit={() => setDirty(false)} className="mt-5 border-t border-[var(--border)] pt-4">
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="itemId" value={item.itemId} />

        {rubric ? (
          <div className="mb-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {t("marking.matrix")}
            </p>
            {rubric.dimensions.map((dimension) => (
              <label key={dimension.id} className="block text-sm">
                <span className="mb-1 block font-medium">{dimension.title}</span>
                <select
                  name={`level:${dimension.id}`}
                  value={levels[dimension.id] ?? ""}
                  onChange={(event) => {
                    setLevels({ ...levels, [dimension.id]: event.target.value });
                    changed();
                  }}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                >
                  <option value="">{t("marking.notJudged")}</option>
                  {rubric.levels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label} ({level.minPercent}–{level.maxPercent}%)
                      {rubric.descriptors[`${dimension.id}:${level.id}`]
                        ? `: ${rubric.descriptors[`${dimension.id}:${level.id}`].slice(0, 90)}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {fromRubric !== null ? (
              <p className="text-sm tabular-nums">{t("marking.rubricGives", { marks: fromRubric, points: item.points })}</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">
              {t("marking.marks")} {rubric ? t("marking.overrides") : ""}
            </span>
            <input
              type="number"
              name="marks"
              step="0.5"
              min={0}
              max={item.points}
              value={marks}
              onChange={(event) => {
                setMarks(event.target.value);
                changed();
              }}
              className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>

          <label className="min-w-64 flex-1 text-sm">
            <span className="mb-1 block font-medium">{t("marking.told")}</span>
            <input
              name="comment"
              defaultValue={item.comment ?? ""}
              onChange={changed}
              placeholder={t("marking.toldHint")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={marking}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium transition hover:bg-[var(--brand-accent)]/10 disabled:opacity-60"
          >
            {marking ? t("common.saving") : t("marking.saveMark")}
          </button>
        </div>

        {departs || item.overrideReason ? (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium">
              {t("marking.reason", { marks: item.autoMarks ?? 0 })}
            </span>
            <input
              name="overrideReason"
              defaultValue={item.overrideReason ?? ""}
              onChange={changed}
              placeholder={t("marking.reasonHint")}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
        ) : null}

        <p className="mt-2 min-h-4 text-xs" aria-live="polite">
          <span className={state.error ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
            {state.error ?? status}
          </span>
        </p>
      </form>
    </section>
  );
}

/** What the learner gave, in the shape the question asked for. */
function LearnerAnswer({ item }: { item: MarkedItem }) {
  const t = useT();

  if (item.type === "matching" && item.matchPrompts) {
    return (
      <ul className="mt-2 space-y-1 text-sm">
        {item.matchPrompts.map((prompt) => {
          const given = item.matchedPairs?.[prompt.id];
          const right = item.correctMatches?.[prompt.id];
          const text = (id: string | undefined) => item.options?.find((option) => option.id === id)?.text ?? "";
          return (
            <li key={prompt.id}>
              {prompt.text}:{" "}
              <span className={given ? (given === right ? "text-[var(--success)]" : "text-[var(--danger)]") : "italic text-[var(--muted)]"}>
                {given ? text(given) : t("marking.blank")}
              </span>
              {given !== right && right ? <span className="text-[var(--muted)]"> ({t("marking.keySays", { answer: text(right) })})</span> : null}
            </li>
          );
        })}
      </ul>
    );
  }

  const options = item.options ? (
    <ul className="mt-2 space-y-1 text-sm">
      {item.options.map((option) => {
        const chosen = item.selectedOptionIds?.includes(option.id);
        const correct = item.correctOptionIds?.includes(option.id);
        return (
          <li
            key={option.id}
            className={
              chosen
                ? correct
                  ? "text-[var(--success)]"
                  : "text-[var(--danger)]"
                : correct
                  ? "text-[var(--muted)]"
                  : ""
            }
          >
            {chosen ? "● " : "○ "}
            {option.text}
            {correct ? ` ${t("marking.isCorrect")}` : ""}
          </li>
        );
      })}
    </ul>
  ) : null;

  const text = item.answerText ? (
    <>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.answerText}</p>
      <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">{t("marking.words", { count: wordCount(item.answerText) })}</p>
    </>
  ) : null;

  const files = item.files.length > 0 ? <Files files={item.files} /> : null;
  const number = item.answerNumber !== null ? <p className="mt-2 text-sm tabular-nums">{Number(item.answerNumber)}</p> : null;

  if (!options && !text && !files && !number) {
    return <p className="mt-2 text-sm italic text-[var(--muted)]">{t("marking.blank")}</p>;
  }
  return (
    <>
      {options}
      {item.selectedOptionIds === null && options && item.type !== "true_false_justified" ? (
        <p className="mt-1 text-sm italic text-[var(--muted)]">{t("marking.blank")}</p>
      ) : null}
      {text}
      {number}
      {files}
    </>
  );
}

/** The memorandum's side: guidance, and the feedback written for each answer. */
function Guidance({ item }: { item: MarkedItem }) {
  const t = useT();
  const chosenRight =
    item.correctOptionIds && item.selectedOptionIds
      ? item.correctOptionIds.length === item.selectedOptionIds.length &&
        item.correctOptionIds.every((id) => item.selectedOptionIds!.includes(id))
      : null;
  if (!item.markingGuide && !item.feedbackCorrect && !item.feedbackIncorrect) return null;
  return (
    <div className="space-y-3">
      {item.markingGuide ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("marking.guidance")}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
            {item.markingGuide}
          </p>
        </div>
      ) : null}
      {item.feedbackCorrect || item.feedbackIncorrect ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("marking.rationale")}
          </p>
          {item.feedbackCorrect ? (
            <p className={`mt-1 text-sm ${chosenRight === true ? "" : "text-[var(--muted)]"}`}>
              {t("marking.ifRight")} {item.feedbackCorrect}
            </p>
          ) : null}
          {item.feedbackIncorrect ? (
            <p className={`mt-1 text-sm ${chosenRight === false ? "" : "text-[var(--muted)]"}`}>
              {t("marking.ifWrong")} {item.feedbackIncorrect}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Files the learner handed in: opened in place where a browser can show them. */
function Files({ files }: { files: MarkedItem["files"] }) {
  const t = useT();
  return (
    <ul className="mt-2 space-y-3 text-sm">
      {files.map((file) => (
        <li key={file.id}>
          <a href={`/api/evidence/${file.id}`} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
            {file.filename}
          </a>
          <span className="ml-2 text-xs text-[var(--muted)]">{size(file.sizeBytes)}</span>
          {file.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/evidence/${file.id}`} alt={file.filename} className="mt-2 max-h-80 rounded-md border border-[var(--border)]" />
          ) : file.mimeType.startsWith("video/") ? (
            <video controls preload="metadata" src={`/api/evidence/${file.id}`} className="mt-2 w-full max-w-xl rounded-md bg-black" />
          ) : file.mimeType.startsWith("audio/") ? (
            <audio controls preload="metadata" src={`/api/evidence/${file.id}`} className="mt-2 w-full max-w-md" />
          ) : file.mimeType === "application/pdf" ? (
            <span className="ml-2 text-xs text-[var(--muted)]">{t("marking.opensInTab")}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function noSubscription() {
  return () => {};
}

/** Remembered in this browser until it is returned, so a lost connection loses nothing. */
function useDraft(key: string, initial: string) {
  // Read from the browser once on the client; the server has no draft to offer.
  const kept = useSyncExternalStore(
    noSubscription,
    () => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Storage refused: the box still works, it simply is not remembered.
        return null;
      }
    },
    () => null,
  );
  const [edited, setEdited] = useState<string | null>(null);
  const value = edited ?? (initial || kept || "");
  const update = (next: string) => {
    setEdited(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // As above.
    }
  };
  const clear = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // As above.
    }
  };
  return [value, update, clear] as const;
}

function FeedbackPanel({
  paper,
  criteria,
  next,
}: {
  paper: MarkedPaper;
  criteria: { id: string; code: string; description: string }[];
  next: string | null;
}) {
  const t = useT();
  const [state, act, pending] = useActionState<MarkState, FormData>(
    returnFeedbackAction,
    {},
  );
  const [fileState, addFile, adding] = useActionState<FileState, FormData>(addFeedbackFileAction, {});
  const [comments, setComments, clearDraft] = useDraft(`feedback:${paper.submissionId}`, paper.feedbackComments ?? "");

  useEffect(() => {
    if (state.returned) clearDraft();
  }, [state.returned, clearDraft]);

  if (state.returned) {
    return (
      <section className="rounded-lg border border-[var(--success)]/40 bg-[var(--success)]/5 p-5">
        <p className="text-sm font-medium">{t("marking.returnedNow", { name: paper.learnerName })}</p>
        {next ? (
          <a href={next} className="mt-2 inline-block text-sm font-medium text-[var(--brand-accent)] underline underline-offset-2">
            {t("marking.next")}
          </a>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">{t("marking.nothingNext")}</p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-5">
      <h2 className="text-base font-semibold">{t("marking.return")}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t("marking.returnIntro")}</p>
      {paper.returned ? <p className="mt-2 text-sm">{t("marking.alreadyReturned")}</p> : null}

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <div className="mt-4">
        <p className="text-sm font-medium">{t("marking.files")}</p>
        <p className="text-xs text-[var(--muted)]">{t("marking.filesHint")}</p>
        {paper.attachments.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {paper.attachments.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3">
                <a href={`/api/feedback-files/${file.id}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {file.filename}
                </a>
                <span className="text-xs text-[var(--muted)]">{size(file.sizeBytes)}</span>
                <form action={removeFeedbackFileAction}>
                  <input type="hidden" name="attachmentId" value={file.id} />
                  <button type="submit" className="text-xs text-[var(--danger)] underline underline-offset-2">
                    {t("marking.removeFile")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <form action={addFile} className="mt-2 flex flex-wrap items-center gap-3">
          <input type="hidden" name="submissionId" value={paper.submissionId} />
          <input type="file" name="file" accept="audio/*,video/*,image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" className="text-sm" />
          <button
            type="submit"
            disabled={adding}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {adding ? t("marking.attaching") : t("marking.attach")}
          </button>
          {fileState.error ? <span role="alert" className="text-sm text-[var(--danger)]">{fileState.error}</span> : null}
        </form>
      </div>

      <form action={act} className="mt-5 space-y-3">
        <input type="hidden" name="submissionId" value={paper.submissionId} />

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("common.comments")}</span>
          <textarea
            name="comments"
            rows={4}
            required
            value={comments}
            onChange={(event) => setComments(event.target.value)}
            placeholder={t("marking.returnHint")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <span className="mt-0.5 block text-xs text-[var(--muted)]">{t("marking.draftKept")}</span>
        </label>

        {criteria.length > 0 ? (
          <fieldset className="text-sm">
            <legend className="mb-1 font-medium">{t("marking.concern")}</legend>
            <div className="space-y-1">
              {criteria.map((criterion) => (
                <label key={criterion.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="criteriaOfConcern"
                    value={criterion.id}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-mono text-xs">{criterion.code}</span>{" "}
                    {criterion.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <p className="text-sm tabular-nums">
          {t("marking.returningWith", { awarded: paper.marksAwarded, available: paper.marksAvailable, percent: Math.round(paper.percentage) })}
        </p>

        <button
          type="submit"
          disabled={pending || !paper.fullyMarked}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? t("marking.returning") : t("marking.returnButton")}
        </button>
        {!paper.fullyMarked ? (
          <span className="ml-3 text-xs text-[var(--muted)]">{t("marking.markEveryFirst")}</span>
        ) : null}
      </form>
    </section>
  );
}

/**
 * A comment on one section of the learner's work.
 *
 * Saved on its own, as each question is, because a facilitator writes these
 * while reading rather than at the end, and saved by itself a moment after
 * typing stops. It sits below the questions it refers to so the connection is
 * visible rather than remembered.
 */
function SectionComment({
  submissionId,
  section,
}: {
  submissionId: string;
  section: { id: string; title: string; comment: string | null };
}) {
  const t = useT();
  const [state, save, saving] = useActionState<SectionState, FormData>(
    commentOnSectionAction,
    {},
  );
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <form
      ref={form}
      action={save}
      className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--background)] p-4"
    >
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="sectionId" value={section.id} />

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          {t("marking.sectionComment", { section: section.title })}
        </span>
        <textarea
          name="comments"
          rows={3}
          defaultValue={section.comment ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            if (timer.current) clearTimeout(timer.current);
            // Ten characters is the shortest comment the server accepts.
            if (value.trim().length >= 10) {
              timer.current = setTimeout(() => form.current?.requestSubmit(), 1500);
            }
          }}
          placeholder={t("marking.sectionHint")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {saving
            ? t("common.saving")
            : section.comment
              ? t("marking.updateComment")
              : t("marking.saveComment")}
        </button>

        {state.error ? (
          <span role="alert" className="text-sm text-[var(--danger)]">
            {state.error}
          </span>
        ) : null}
        {state.saved === section.id ? (
          <span className="text-sm text-[var(--success)]">{t("common.saved")}</span>
        ) : null}
        {!state.error && !state.saved && section.comment ? (
          <span className="text-xs text-[var(--muted)]">{t("marking.learnerSees")}</span>
        ) : null}
      </div>
    </form>
  );
}
