"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { markLessonCompleteAction, type LearnState } from "../actions";
import { LessonMediaView } from "@/components/lesson-media";
import { ScormPlayer } from "@/components/scorm-player";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

type Lesson = {
  id: string;
  title: string;
  contentType: string;
  body: string | null;
  externalUrl: string | null;
  durationMinutes: number | null;
  state: string;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaSizeBytes: number | null;
};

type Section = { id: string; title: string; lessons: Lesson[] };

export function CoursePlayer({
  enrolmentId,
  sections,
  completedLessons,
  totalLessons,
  percentage,
  canRecordProgress,
}: {
  enrolmentId: string;
  sections: Section[];
  completedLessons: number;
  totalLessons: number;
  percentage: number;
  canRecordProgress: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const allLessons = sections.flatMap((section) => section.lessons);

  // Open on the first unfinished lesson, so returning to a course resumes
  // where the learner stopped rather than at the beginning.
  const firstIncomplete = allLessons.find(
    (lesson) => lesson.state !== "completed",
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    firstIncomplete?.id ?? allLessons[0]?.id ?? null,
  );

  const [state, formAction, pending] = useActionState<LearnState, FormData>(
    markLessonCompleteAction,
    {},
  );

  const selected = allLessons.find((lesson) => lesson.id === selectedId);

  if (allLessons.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm text-[var(--muted)]">{t("learn.noLessons")}</p>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside className="space-y-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-baseline justify-between">
            {/* Lessons, said as lessons. The step list above counts every
                step, assessments included, and until 26 September this panel
                was headed "Progress" as well, so one page gave a learner two
                different answers to the same question. */}
            <span className="text-sm font-medium">{t("learn.lessons")}</span>
            <span className="text-sm text-[var(--muted)]">
              {t("learn.lessonsDone", { done: completedLessons, total: totalLessons })}
            </span>
          </div>

          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--border)]"
            role="progressbar"
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("learn.lessons")}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${percentage}%`,
                background: "var(--brand-accent)",
              }}
            />
          </div>

          {percentage === 100 ? (
            <p className="mt-3 text-sm font-medium text-[var(--success)]">{t("learn.complete")}</p>
          ) : null}
        </section>

        <nav className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          {sections.map((section, sectionIndex) => (
            <div key={section.id} className="mb-4 last:mb-0">
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {sectionIndex + 1}. {section.title}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {section.lessons.map((lesson) => {
                  const done = lesson.state === "completed";
                  const active = lesson.id === selectedId;
                  return (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(lesson.id)}
                        aria-current={active ? "true" : undefined}
                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                          active
                            ? "bg-[var(--brand-primary)]/8 font-medium"
                            : "hover:bg-[var(--border)]/40"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: done
                              ? "var(--success)"
                              : "var(--border)",
                          }}
                        />
                        <span>
                          {lesson.title}
                          <span className="sr-only">
                            {` ${done ? t("learn.lessonDone") : t("learn.lessonNotDone")}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        {selected ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-lg font-medium">{selected.title}</h2>
              <span className="text-xs capitalize text-[var(--muted)]">
                {maybe(t, `learn.content.${selected.contentType}`) ?? selected.contentType.replace(/_/g, " ")}
                {selected.durationMinutes
                  ? ` · ${t("learn.minutes", { minutes: selected.durationMinutes })}`
                  : ""}
              </span>
            </div>

            <div className="mt-4 min-h-32 space-y-4 text-sm leading-relaxed">
              {selected.contentType === "scorm" ? (
                // Keyed on the lesson, so moving to another lesson ends this
                // package's session before the next one starts.
                <ScormPlayer
                  key={selected.id}
                  lessonId={selected.id}
                  enrolmentId={canRecordProgress ? enrolmentId : null}
                  onCompleted={() => router.refresh()}
                />
              ) : selected.mediaMimeType ? (
                <LessonMediaView
                  media={{
                    lessonId: selected.id,
                    mimeType: selected.mediaMimeType,
                    filename: selected.mediaFilename,
                    sizeBytes: selected.mediaSizeBytes,
                  }}
                />
              ) : null}

              {selected.body ? (
                <div className="whitespace-pre-wrap">{selected.body}</div>
              ) : selected.mediaMimeType || selected.contentType === "scorm" ? null : selected.externalUrl ? (
                <a
                  href={selected.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--brand-accent)] hover:underline"
                >
                  {t("learn.openMaterial")}
                </a>
              ) : (
                <p className="text-[var(--muted)]">{t("learn.noContent")}</p>
              )}
            </div>

            {state.error ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
              >
                {state.error}
              </p>
            ) : null}

            <div className="mt-6 border-t border-[var(--border)] pt-4">
              {selected.state === "completed" ? (
                <p className="text-sm font-medium text-[var(--success)]">{t("learn.completed")}</p>
              ) : selected.contentType === "scorm" ? (
                // The package says when it is finished, not a button.
                <p className="text-sm text-[var(--muted)]">{t("learn.scormNote")}</p>
              ) : canRecordProgress ? (
                <form action={formAction}>
                  <input
                    type="hidden"
                    name="enrolmentId"
                    value={enrolmentId}
                  />
                  <input type="hidden" name="lessonId" value={selected.id} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-md px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    style={{ background: "var(--brand-primary)" }}
                  >
                    {pending ? t("account.saving") : t("learn.markComplete")}
                  </button>
                </form>
              ) : (
                <p className="text-sm text-[var(--muted)]">{t("learn.notCompleted")}</p>
              )}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
