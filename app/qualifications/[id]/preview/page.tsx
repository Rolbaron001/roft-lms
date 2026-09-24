import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { previewQualification, PreviewError } from "@/lib/qualification-preview";
import { vocabulary } from "@/lib/terms";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { StartUnit } from "./start-unit";

/**
 * A qualification walked as a learner will meet it.
 *
 * Job sheet 2.1. /papers/[id]/preview covers one paper; this covers the whole
 * programme in the order somebody enrolled on it walks it, and says what they
 * would not find.
 *
 * Nothing here writes. No enrolment, no attempt, no step recorded as opened.
 */
const KIND_LABEL: Record<string, string> = {
  lesson: "Lesson",
  assessment: "Assessment",
  document: "Document",
  workplace: "Workplace",
};

export default async function QualificationPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");

  let preview;
  try {
    preview = await previewQualification(session, id);
  } catch (error) {
    if (error instanceof PreviewError) notFound();
    throw error;
  }

  const words = vocabulary(tenant.terminology);
  const { qualification, counts } = preview;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/qualifications/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          &larr; {qualification.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">As a learner will see it</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          The whole {words.one("programme")} in the order somebody enrolled on
          it walks it. Nothing here starts anything: no enrolment is made, no
          attempt is opened and no progress is recorded, so this can be read as
          often as you like.
        </p>
        <p className="mt-2 text-sm">
          {counts.units} {counts.units === 1 ? "study unit" : "study units"},{" "}
          {counts.steps} {counts.steps === 1 ? "step" : "steps"},{" "}
          <span
            className={
              counts.ready === counts.steps
                ? "font-medium"
                : "font-medium text-[var(--danger)]"
            }
          >
            {counts.ready} of {counts.steps} ready
          </span>
          .
        </p>
      </div>

      {/*
        What is missing, first and in full.

        The authoring screens show what exists. The point of this one is what
        is reachable, so the holes go at the top rather than being left for
        somebody to notice by scrolling.
      */}
      {preview.gaps.length > 0 ? (
        <div className="mb-6">
          <Card title="What a learner would not find">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {preview.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <div className="mb-6">
          <Card title="Ready">
            <p className="text-sm">
              Every step in every study unit has something behind it. A learner
              enrolled on this {words.one("programme")} today would find the
              whole of it.
            </p>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        {preview.units.map((unit) => (
          <Card key={unit.id}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">
                {unit.code} {unit.title}
              </span>
              {unit.credits !== null ? (
                <span className="text-xs text-[var(--muted)]">
                  {unit.credits} credits
                </span>
              ) : null}
              {unit.steps.length > 0 ? (
                <span className="text-xs text-[var(--muted)]">
                  {unit.steps.length}{" "}
                  {unit.steps.length === 1 ? "step" : "steps"}
                </span>
              ) : null}
            </div>

            {unit.outcome ? (
              <p className="mt-1 text-xs text-[var(--muted)]">{unit.outcome}</p>
            ) : null}

            {unit.steps.length === 0 ? (
              <>
                <p className="mt-3 text-sm text-[var(--danger)]">
                  {unit.gaps[0]}
                </p>
                {/*
                  Naming a gap and offering no way to close it is half a
                  screen, so each one ends with the next thing to do.
                */}
                {unit.courseId ? (
                  <Link
                    href={`/courses/${unit.courseId}/steps`}
                    className="mt-2 inline-block text-sm underline underline-offset-2"
                  >
                    Build what a learner works through
                  </Link>
                ) : (
                  <StartUnit qualificationId={id} studyUnitId={unit.id} />
                )}
              </>
            ) : (
              <ol className="mt-3 space-y-2">
                {unit.steps.map((step, index) => (
                  <li
                    key={step.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-[var(--border)] pt-2 text-sm first:border-0 first:pt-0"
                  >
                    <span className="text-xs text-[var(--muted)]">
                      {index + 1}.
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {KIND_LABEL[step.kind] ?? step.kind}
                    </span>
                    <span className={step.ready ? "" : "text-[var(--danger)]"}>
                      {step.title}
                    </span>
                    {step.optional ? (
                      <span className="text-xs text-[var(--muted)]">
                        optional
                      </span>
                    ) : null}
                    {step.note ? (
                      <span className="text-xs text-[var(--danger)]">
                        {step.note}
                      </span>
                    ) : null}
                    {step.href ? (
                      <Link
                        href={step.href}
                        className="text-xs underline underline-offset-2"
                      >
                        Open it as a learner sees it
                      </Link>
                    ) : null}
                    {step.guidance ? (
                      <span className="block w-full text-xs text-[var(--muted)]">
                        {step.guidance}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}

            {unit.courseId && unit.steps.length > 0 ? (
              <Link
                href={`/courses/${unit.courseId}/steps`}
                className="mt-3 inline-block text-xs underline underline-offset-2"
              >
                Change the order or what is on it
              </Link>
            ) : null}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
