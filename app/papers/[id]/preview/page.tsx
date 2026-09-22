import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { previewPaper, PaperError } from "@/lib/papers";
import { captureOrigin, wayBackFrom } from "@/lib/capture";
import { AppShell, Card } from "@/components/app-shell";

/**
 * A paper as the learner will meet it, for the person who wrote it.
 *
 * Roland, 20 September: "Workbooks and assessments are supposed to be 'Built
 * into' the LMS ... screens with textboxes that a user types into, completes
 * checkboxes, etc. Is this working? How do I see it (outside of being a
 * learner)?"
 *
 * It was working, and nothing anywhere showed it. Capture read a workbook into
 * a paper, committed it, and redirected to a list. The only screen that ever
 * rendered a paper needed an enrolment and started a real attempt on arrival,
 * so seeing your own paper meant enrolling on it and beginning to sit it.
 *
 * A tested pipeline with no screen is a feature that does not exist. This is
 * the screen.
 *
 * It writes nothing - no attempt, no submission, no clock - and every control
 * is disabled, so it cannot be half-sat by accident. Because the reader is the
 * author, it also shows what a learner is never shown: which answer the
 * memorandum marks correct, what the marking guide says, and which questions
 * the platform can mark at all.
 */
export default async function PaperPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:author");

  let paper;
  try {
    paper = await previewPaper(session, id);
  } catch (error) {
    if (error instanceof PaperError) notFound();
    throw error;
  }

  const items = paper.sections.flatMap((section) => section.items);
  const byApp = items.filter((item) => item.markedBy === "app").length;
  const back = wayBackFrom(await captureOrigin(session, { paperId: id }));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        {/*
          Back to where the work started, which after a commit is the
          qualification rather than the upload list. Roland, 22 September.
        */}
        <Link
          href={back.href}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          &larr; {back.label}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {paper.assessmentTitle}{" "}
          <span className="text-[var(--muted)]">&middot; {paper.paperCode}</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {paper.purpose === "summative"
            ? "Summative — judged by a person and independently moderated"
            : "Formative — marked as the learner goes"}
          {" · "}
          {items.length} {items.length === 1 ? "question" : "questions"}
          {" · "}
          {paper.totalMarks} marks
          {" · "}
          {byApp} marked by the App, {items.length - byApp} by an assessor
          {paper.timeLimitMinutes
            ? ` · ${paper.timeLimitMinutes} minutes`
            : " · untimed"}
          {" · "}
          {paper.status === "published" ? "Published" : "Draft"}
        </p>
      </div>

      {/*
        Said once, at the top, and meant. Somebody arriving from the commit
        screen has just come through a form that did write things, and needs to
        know that this one does not.
      */}
      <div
        className="mb-6 rounded-lg border-2 px-4 py-3"
        style={{ borderColor: "var(--brand-accent)" }}
      >
        <p
          className="text-sm font-medium"
          style={{ color: "var(--brand-accent)" }}
        >
          This is a preview.
        </p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Exactly what a learner sees, with the boxes they would type into.
          Nothing is saved and no attempt has been started, so the controls are
          switched off. The panel under each question is for you because you
          built this paper &mdash; a learner never sees it.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm">There are no questions in this paper yet.</p>
        </Card>
      ) : null}

      <div className="space-y-5">
        {paper.sections.map((section) => (
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

            <ol className="mt-4 space-y-6">
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
                    </span>
                  </div>

                  {/*
                    The learner's half, rendered with the same controls the real
                    form uses and disabled throughout. Deliberately the controls
                    rather than a description of them: the question worth
                    answering here is "does this look right to answer", and a
                    list of question text cannot answer it.
                  */}
                  <div className="mt-2 pl-6">
                    {item.options ? (
                      <fieldset className="space-y-1.5" disabled>
                        <legend className="sr-only">{item.stem}</legend>
                        {item.options.map((option) => (
                          <label
                            key={option.id}
                            className="flex items-start gap-2 text-sm"
                          >
                            <input
                              type="radio"
                              name={item.id}
                              className="mt-1"
                              disabled
                            />
                            <span>{option.text}</span>
                            {item.correctOptionIds?.includes(option.id) ? (
                              <span
                                className="text-xs font-medium"
                                style={{ color: "var(--success)" }}
                              >
                                &#10003; correct
                              </span>
                            ) : null}
                          </label>
                        ))}
                      </fieldset>
                    ) : item.type === "numeric" ? (
                      <input
                        type="number"
                        disabled
                        placeholder="A number"
                        className="w-40 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                      />
                    ) : (
                      <textarea
                        disabled
                        rows={item.type === "long_answer" ? 10 : 3}
                        placeholder={
                          item.type === "long_answer"
                            ? "Answer in detail, referring to the principles you have studied."
                            : "Your answer"
                        }
                        className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm leading-relaxed"
                      />
                    )}
                  </div>

                  {/*
                    The author's half. A parser that got question three's correct
                    answer wrong is invisible until a learner appeals, so the
                    answer sits beside the question rather than in the document
                    it was read from.
                  */}
                  <div className="mt-3 ml-6 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {item.markedBy === "app"
                        ? "Marked by the App"
                        : "Marked by an assessor"}
                    </p>
                    {item.markingGuide ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm">
                        {item.markingGuide}
                      </p>
                    ) : item.markedBy === "app" ? (
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        The correct option is ticked above.
                      </p>
                    ) : (
                      <p
                        className="mt-1 text-sm"
                        style={{ color: "var(--danger)" }}
                      >
                        No marking guide. An assessor has nothing to mark this
                        against &mdash; add one before the paper is used.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      {items.length > 0 ? (
        <div className="mt-5">
          <Card title="Declaration">
            <p className="text-sm text-[var(--muted)]">
              A learner cannot hand this in without agreeing to it, and the
              exact wording is frozen into the submission.
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {paper.declarationText}
            </p>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
