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

type Section = {
  id: string;
  title: string;
  lessons: { id: string; title: string; contentType: string }[];
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
  courseId,
  status,
  sections,
  taggedCompetencies,
  availableCompetencies,
  report,
  canAuthor,
  canPublish,
}: {
  courseId: string;
  status: string;
  sections: Section[];
  taggedCompetencies: { competencyId: string; code: string; name: string }[];
  availableCompetencies: Competency[];
  report: CoverageReport;
  canAuthor: boolean;
  canPublish: boolean;
}) {
  const editable = canAuthor && status === "draft";

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
            Content
          </h2>

          {sections.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              No sections yet. A course is built from sections, and each section
              holds lessons.
            </p>
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
                    <ul className="mt-2 space-y-1">
                      {section.lessons.map((lesson) => (
                        <li
                          key={lesson.id}
                          className="flex items-center justify-between gap-3 text-sm text-[var(--muted)]"
                        >
                          <span>{lesson.title}</span>
                          <span className="text-xs capitalize">
                            {lesson.contentType.replace(/_/g, " ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      No lessons in this section yet.
                    </p>
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
                          placeholder="Lesson title"
                          className={inputClass}
                        />

                        <select
                          name="contentType"
                          defaultValue="text"
                          className={inputClass}
                        >
                          <option value="text">Text</option>
                          <option value="video">Video</option>
                          <option value="document">Document</option>
                          <option value="slide_deck">Slide deck</option>
                          <option value="live_session">Live session</option>
                          <option value="practical_task">Practical task</option>
                          <option value="workplace_logbook">
                            Workplace logbook
                          </option>
                        </select>

                        <textarea
                          name="body"
                          rows={3}
                          placeholder="Lesson content (optional)"
                          className={inputClass}
                        />

                        {report.criteria.length > 0 ? (
                          <fieldset className="rounded-md border border-[var(--border)] p-3">
                            <legend className="px-1 text-xs font-medium">
                              Assessment criteria this lesson covers
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
                            {lessonPending ? "Adding…" : "Add lesson"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenLessonFor(null)}
                            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenLessonFor(section.id)}
                        className="mt-3 text-sm font-medium text-[var(--brand-accent)] hover:underline"
                      >
                        + Add a lesson
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
                placeholder="New section title"
                className={inputClass}
              />
              <button
                type="submit"
                disabled={sectionPending}
                className="whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
              >
                {sectionPending ? "Adding…" : "Add section"}
              </button>
            </form>
          ) : null}
        </section>

        {/* ---------------------------------------------------- competencies */}
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Competencies
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            What completing this course demonstrates. A course with no
            competency cannot be published, because its completions could not be
            reported as capability.
          </p>

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
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">
              None tagged yet.
            </p>
          )}

          <div className="mt-3">
            <Message state={tagState} />
          </div>

          {editable && untagged.length > 0 ? (
            <form action={tagAction} className="mt-4 flex gap-2">
              <input type="hidden" name="courseId" value={courseId} />
              <select name="competencyId" defaultValue="" className={inputClass}>
                <option value="">Choose a competency…</option>
                {untagged.map((competency) => (
                  <option key={competency.id} value={competency.id}>
                    {competency.code} — {competency.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={tagPending}
                className="whitespace-nowrap rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
              >
                {tagPending ? "Tagging…" : "Tag"}
              </button>
            </form>
          ) : null}
        </section>
      </div>

      {/* ------------------------------------------------- coverage sidebar */}
      <aside className="space-y-6">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Readiness
          </h2>

          {report.curriculumModuleId ? (
            <>
              <p className="mt-3 text-sm">
                <span className="text-2xl font-semibold">
                  {report.criteria.length - report.uncovered.length}
                </span>
                <span className="text-[var(--muted)]">
                  {" "}
                  of {report.criteria.length} assessment criteria covered
                </span>
              </p>

              <ul className="mt-4 space-y-2">
                {report.criteria.map((criterion) => {
                  const covered = criterion.coveredByLessons > 0;
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
                        <span className="font-medium">{criterion.code}</span>
                        <span className="sr-only">
                          {covered ? " covered" : " not covered"}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">
                          {covered
                            ? `${criterion.coveredByLessons} ${
                                criterion.coveredByLessons === 1
                                  ? "lesson"
                                  : "lessons"
                              }`
                            : "No lesson covers this"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">
              This course is not bound to an accredited curriculum module, so
              there are no assessment criteria to cover.
            </p>
          )}

          <dl className="mt-5 space-y-1 border-t border-[var(--border)] pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Lessons</dt>
              <dd>{report.lessonCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Competencies</dt>
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
                {publishPending ? "Checking…" : "Publish course"}
              </button>
            </form>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Publishing is refused while anything above is incomplete.
            </p>
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
                {versionPending ? "Creating…" : "Start a new version"}
              </button>
            </form>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Learners who completed this version keep their record of it.
            </p>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
