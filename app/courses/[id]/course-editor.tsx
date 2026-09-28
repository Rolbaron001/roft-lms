"use client";

import { useActionState, useState } from "react";
import {
  addLessonAction,
  addSectionAction,
  newVersionAction,
  publishCourseAction,
  tagCompetencyAction,
  untagCompetencyAction,
  type ActionState,
} from "../actions";
import type { CoverageReport } from "@/lib/authoring";
import { LessonUpload } from "@/components/lesson-upload";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const LESSON_TYPES = ["text", "video", "document", "slide_deck", "live_session", "practical_task"] as const;

type Section = {
  id: string;
  title: string;
  lessons: {
    id: string;
    title: string;
    contentType: string;
    mediaFilename: string | null;
    mediaMimeType: string | null;
  }[];
};

type Competency = { id: string; code: string; name: string };

function Message({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export function CourseEditor({
  /** What this provider calls a workplace experience sign-off. */
  workplaceRecordWord,
  courseId,
  status,
  sections,
  taggedCompetencies,
  availableCompetencies,
  report,
  canAuthor,
  canPublish,
}: {
  workplaceRecordWord: string;
  courseId: string;
  status: string;
  sections: Section[];
  taggedCompetencies: { competencyId: string; code: string; name: string }[];
  availableCompetencies: Competency[];
  report: CoverageReport;
  canAuthor: boolean;
  canPublish: boolean;
}) {
  const t = useT();
  const editable = canAuthor && status === "draft";
  const typeName = (type: string) =>
    type === "workplace_logbook"
      ? workplaceRecordWord
      : (maybe(t, `courseEdit.type.${type}`) ?? type.replace(/_/g, " "));

  const [sectionState, sectionAction, sectionPending] = useActionState<
    ActionState,
    FormData
  >(addSectionAction, {});
  const [lessonState, lessonAction, lessonPending] = useActionState<
    ActionState,
    FormData
  >(addLessonAction, {});
  const [tagState, tagAction, tagPending] = useActionState<
    ActionState,
    FormData
  >(tagCompetencyAction, {});
  const [publishState, publishAction, publishPending] = useActionState<
    ActionState,
    FormData
  >(publishCourseAction, {});
  const [versionState, versionAction, versionPending] = useActionState<
    ActionState,
    FormData
  >(newVersionAction, {});

  const [openLessonFor, setOpenLessonFor] = useState<string | null>(null);

  const untagged = availableCompetencies.filter(
    (competency) =>
      !taggedCompetencies.some((tag) => tag.competencyId === competency.id),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        {/* ---------------------------------------------------------- content */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("courseEdit.content")}
          </h2>

          {sections.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">{t("courseEdit.noSections")}</p>
          ) : (
            <ol className="mt-4 space-y-4">
              {sections.map((section, index) => (
                <li
                  key={section.id}
                  className="rounded-md border border-[var(--border)] p-4"
                >
                  <p className="text-sm font-medium">
                    {index + 1}. {section.title}
                  </p>

                  {section.lessons.length > 0 ? (
                    <ul className="mt-2 space-y-3">
                      {section.lessons.map((lesson) => (
                        <li
                          key={lesson.id}
                          className="rounded-md border border-[var(--border)] px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span>{lesson.title}</span>
                            <span className="text-xs text-[var(--muted)]">
                              {typeName(lesson.contentType)}
                            </span>
                          </div>
                          <div className="mt-2">
                            <LessonUpload
                              lessonId={lesson.id}
                              existing={{
                                filename: lesson.mediaFilename,
                                mimeType: lesson.mediaMimeType,
                              }}
                              disabled={!editable}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--muted)]">{t("courseEdit.noLessons")}</p>
                  )}

                  {editable ? (
                    openLessonFor === section.id ? (
                      <form action={lessonAction} className="mt-4 space-y-3">
                        <input type="hidden" name="courseId" value={courseId} />
                        <input
                          type="hidden"
                          name="sectionId"
                          value={section.id}
                        />

                        <input
                          name="title"
                          required
                          placeholder={t("courseEdit.lessonTitle")}
                          className={inputClass}
                        />

                        <select
                          name="contentType"
                          defaultValue="text"
                          className={inputClass}
                        >
                          {LESSON_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {typeName(type)}
                            </option>
                          ))}
                          <option value="workplace_logbook">
                            {workplaceRecordWord}
                          </option>
                        </select>

                        <textarea
                          name="body"
                          rows={3}
                          placeholder={t("courseEdit.lessonBody")}
                          className={inputClass}
                        />

                        {report.criteria.length > 0 ? (
                          <fieldset className="rounded-md border border-[var(--border)] p-3">
                            <legend className="px-1 text-xs font-medium">
                              {t("courseEdit.lessonCovers")}
                            </legend>
                            <div className="space-y-1.5">
                              {report.criteria.map((criterion) => (
                                <label
                                  key={criterion.id}
                                  className="flex gap-2 text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    name="criterionIds"
                                    value={criterion.id}
                                    className="mt-1"
                                  />
                                  <span>
                                    <span className="font-medium">
                                      {criterion.code}
                                    </span>{" "}
                                    <span className="text-[var(--muted)]">
                                      {criterion.description}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        ) : null}

                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={lessonPending}
                            className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                            style={{ background: "var(--brand-primary)" }}
                          >
                            {lessonPending ? t("courseEdit.adding") : t("courseEdit.addLesson")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenLessonFor(null)}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenLessonFor(section.id)}
                        className="mt-3 text-sm font-medium text-[var(--brand-accent)] hover:underline"
                      >
                        {t("courseEdit.addALesson")}
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4 space-y-2">
            <Message state={lessonState} />
            <Message state={sectionState} />
          </div>

          {editable ? (
            <form action={sectionAction} className="mt-4 flex gap-2">
              <input type="hidden" name="courseId" value={courseId} />
              <input
                name="title"
                required
                placeholder={t("courseEdit.sectionTitle")}
                className={inputClass}
              />
              <button
                type="submit"
                disabled={sectionPending}
                className="whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
              >
                {sectionPending ? t("courseEdit.adding") : t("courseEdit.addSection")}
              </button>
            </form>
          ) : null}
        </section>

        {/* ---------------------------------------------------- competencies */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("courseEdit.competencies")}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("courseEdit.competenciesNote")}</p>

          {taggedCompetencies.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {taggedCompetencies.map((tag) => (
                <li
                  key={tag.competencyId}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{tag.code}</span> {tag.name}
                  </span>
                  {editable ? (
                    <form action={untagCompetencyAction}>
                      <input type="hidden" name="courseId" value={courseId} />
                      <input
                        type="hidden"
                        name="competencyId"
                        value={tag.competencyId}
                      />
                      <button
                        type="submit"
                        className="text-xs text-[var(--danger)] hover:underline"
                      >
                        {t("courseEdit.remove")}
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">{t("courseEdit.noneTagged")}</p>
          )}

          <div className="mt-3">
            <Message state={tagState} />
          </div>

          {editable && untagged.length > 0 ? (
            <form action={tagAction} className="mt-4 flex gap-2">
              <input type="hidden" name="courseId" value={courseId} />
              <select name="competencyId" defaultValue="" className={inputClass}>
                <option value="">{t("courseEdit.chooseCompetency")}</option>
                {untagged.map((competency) => (
                  <option key={competency.id} value={competency.id}>
                    {competency.code}: {competency.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={tagPending}
                className="whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
              >
                {tagPending ? t("courseEdit.tagging") : t("courseEdit.tag")}
              </button>
            </form>
          ) : null}
        </section>
      </div>

      {/* ------------------------------------------------- coverage sidebar */}
      <aside className="space-y-6">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("courseEdit.readiness")}
          </h2>

          {report.curriculumModuleId || report.studyUnit ? (
            <>
              <p className="mt-3 text-sm">
                <span className="text-2xl font-semibold">
                  {report.criteria.length - report.uncovered.length}
                </span>
                <span className="text-[var(--muted)]">
                  {" "}
                  {report.studyUnit
                    ? t("courseEdit.coveredAcross", { count: report.criteria.length, unit: report.studyUnit.code })
                    : t("courseEdit.covered", { count: report.criteria.length })}
                </span>
              </p>
              {report.studyUnit ? (
                <p className="mt-2 text-xs text-[var(--muted)]">{t("courseEdit.coveredNote")}</p>
              ) : null}

              <ul className="mt-4 space-y-2">
                {report.criteria.map((criterion) => {
                  const covered = criterion.coveredBy.length > 0;
                  return (
                    <li key={criterion.id} className="flex gap-2 text-sm">
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: covered
                            ? "var(--success)"
                            : "var(--danger)",
                        }}
                      />
                      <span>
                        <span className="font-medium">
                          {criterion.moduleCode ? `${criterion.moduleCode} ` : ""}
                          {criterion.code}
                        </span>
                        <span className="sr-only">
                          {" "}
                          {covered ? t("courseEdit.isCovered") : t("courseEdit.notCovered")}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">
                          {covered
                            ? criterion.coveredBy.join("; ")
                            : report.studyUnit
                              ? t("courseEdit.nothingAssesses")
                              : t("courseEdit.noLessonCovers")}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">{t("courseEdit.unbound")}</p>
          )}

          <dl className="mt-5 space-y-1 border-t border-[var(--border)] pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t("courseEdit.lessons")}</dt>
              <dd>{report.lessonCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">{t("courseEdit.competencies")}</dt>
              <dd>{report.competencyCount}</dd>
            </div>
          </dl>
        </section>

        {canPublish && status === "draft" ? (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <Message state={publishState} />
            <form action={publishAction} className="mt-3">
              <input type="hidden" name="courseId" value={courseId} />
              <button
                type="submit"
                disabled={publishPending}
                className="w-full rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--brand-primary)" }}
              >
                {publishPending ? t("courseEdit.checking") : t("courseEdit.publish")}
              </button>
            </form>
            <p className="mt-2 text-xs text-[var(--muted)]">{t("courseEdit.publishNote")}</p>
          </section>
        ) : null}

        {canAuthor && status === "published" ? (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <Message state={versionState} />
            <form action={versionAction} className="mt-3">
              <input type="hidden" name="courseId" value={courseId} />
              <button
                type="submit"
                disabled={versionPending}
                className="w-full rounded-md border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                {versionPending ? t("courseEdit.creating") : t("courseEdit.newVersion")}
              </button>
            </form>
            <p className="mt-2 text-xs text-[var(--muted)]">{t("courseEdit.newVersionNote")}</p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
