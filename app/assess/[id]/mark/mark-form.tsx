"use client";

import { useActionState } from "react";
import {
  commentOnSectionAction,
  markItemAction,
  returnFeedbackAction,
  type MarkState,
  type SectionState,
} from "./actions";
import type { MarkedItem, MarkedPaper, RubricView } from "@/lib/marking";
import { useT } from "@/components/i18n";

/**
 * Marking a paper question by question.
 *
 * The learner's answer, the model answer and the rubric sit together on one
 * screen, because an assessor who has to hold the memorandum in another window
 * marks less consistently than one who does not. Each question saves on its
 * own: a fifty-mark paper is marked over an hour with interruptions, not in
 * one sitting, and losing half of it to a closed tab would be its own kind of
 * failure.
 */
export function MarkForm({
  paper,
  rubrics,
  criteria,
}: {
  paper: MarkedPaper;
  rubrics: Record<string, RubricView>;
  criteria: { id: string; code: string; description: string }[];
}) {
  const t = useT();
  const [state, mark, marking] = useActionState<MarkState, FormData>(
    markItemAction,
    {},
  );

  /**
   * Questions gathered under the section each belongs to.
   *
   * Driven by the paper's own section order rather than by where the section
   * changes as the items are walked. That distinction is not academic: item
   * sort order restarts at zero in every section, so the flat list interleaves
   * them - A, C, B, D across two sections - and an adjacency-based grouping
   * produced four groups and four comment boxes for two sections.
   *
   * The index is kept from the flat list so question numbering still reads 1
   * to 40 across the whole paper rather than restarting in each section.
   */
  const numbered = paper.items.map((item, index) => ({ item, index }));

  const grouped = [
    ...paper.sections.map((section) => ({
      key: section.id,
      section,
      items: numbered.filter((row) => row.item.sectionId === section.id),
    })),
    // A paper with no sections at all, or an item that belongs to none.
    {
      key: "__none__",
      section: null,
      items: numbered.filter((row) => row.item.sectionId === null),
    },
  ].filter((group) => group.items.length > 0);

  const toMark = paper.items.filter((item) => item.awarded === null).length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">{paper.assessmentTitle}</h2>
          <span className="text-sm tabular-nums">
            {t("marking.total", { awarded: paper.marksAwarded, available: paper.marksAvailable })}
            <span className="ml-2 text-[var(--muted)]">
              {t("marking.percent", { percent: Math.round(paper.percentage), pass: paper.passMark })}
            </span>
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {paper.purpose === "summative" ? t("marking.summative") : t("marking.formative")}
        </p>
        {!paper.fullyMarked ? (
          <p className="mt-2 text-sm">
            {toMark === 1 ? t("marking.toMarkOne") : t("marking.toMarkMany", { count: toMark })}
          </p>
        ) : null}
      </section>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
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
              mark={mark}
              marking={marking}
              justMarked={state.marked === item.itemId}
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
          submissionId={paper.submissionId}
          criteria={criteria}
          fullyMarked={paper.fullyMarked}
        />
      ) : null}
    </div>
  );
}

function Question({
  item,
  index,
  submissionId,
  rubric,
  mark,
  marking,
  justMarked,
}: {
  item: MarkedItem;
  index: number;
  submissionId: string;
  rubric?: RubricView;
  mark: (formData: FormData) => void;
  marking: boolean;
  justMarked: boolean;
}) {
  const t = useT();
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
          {justMarked ? t("marking.saved") : ""}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("marking.answer")}
          </p>
          {item.options ? (
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
          ) : item.answerText ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {item.answerText}
            </p>
          ) : (
            <p className="mt-2 text-sm italic text-[var(--muted)]">{t("marking.blank")}</p>
          )}
        </div>

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
      </div>

      <form action={mark} className="mt-5 border-t border-[var(--border)] pt-4">
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
                  defaultValue={item.chosenLevels?.[dimension.id] ?? ""}
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
              defaultValue={item.awarded ?? ""}
              className="w-28 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>

          <label className="min-w-64 flex-1 text-sm">
            <span className="mb-1 block font-medium">{t("marking.told")}</span>
            <input
              name="comment"
              defaultValue={item.comment ?? ""}
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
      </form>
    </section>
  );
}

function FeedbackPanel({
  submissionId,
  criteria,
  fullyMarked,
}: {
  submissionId: string;
  criteria: { id: string; code: string; description: string }[];
  fullyMarked: boolean;
}) {
  const t = useT();
  const [state, act, pending] = useActionState<MarkState, FormData>(
    returnFeedbackAction,
    {},
  );

  return (
    <section className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 p-5">
      <h2 className="text-base font-semibold">{t("marking.return")}</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{t("marking.returnIntro")}</p>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <form action={act} className="mt-4 space-y-3">
        <input type="hidden" name="submissionId" value={submissionId} />

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("common.comments")}</span>
          <textarea
            name="comments"
            rows={4}
            required
            placeholder={t("marking.returnHint")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
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

        <button
          type="submit"
          disabled={pending || !fullyMarked}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? t("marking.returning") : t("marking.returnButton")}
        </button>
        {!fullyMarked ? (
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
 * while reading rather than at the end. It sits below the questions it refers
 * to so the connection is visible rather than remembered.
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

  return (
    <form
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
